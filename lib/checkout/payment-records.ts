import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPoolAsync } from '@/lib/db/pool';
import type { CompactCartItem } from '@/lib/checkout/cart-metadata';

/**
 * Checkout payment records — `maleq_payment_intent_orders`.
 *
 * This table is the store of record for an in-flight checkout. It holds two
 * things:
 *
 *   1. The **reservation lock**: which of `/api/orders/create`, the webhook, or
 *      the reconciliation cron owns the job of turning a payment into a
 *      WooCommerce order. Exactly one of them may hold it, so a payment can
 *      never produce a duplicate order pair.
 *   2. The **checkout snapshot**: the cart, pricing, shipping selection and
 *      integrity fingerprint captured when the payment was created. Recovery
 *      rebuilds the order from this.
 *
 * The snapshot used to live in Stripe PaymentIntent metadata, chunked across
 * six keys to fit a 500-character-per-value limit. That worked, but it made
 * order recovery depend on a processor-specific feature (50 arbitrary metadata
 * keys) that most gateways do not offer, and made the reconciliation sweep a
 * paginated call to Stripe's API instead of an indexed local query. Holding it
 * here is faster, survives a change of processor, and keeps the recovery data
 * under our own backup policy.
 *
 * Row lifecycle:
 *
 *   pending     written by /api/payment/create-intent alongside the payment
 *                 |                                    \
 *   processing  someone holds the lock                  abandoned (customer
 *                 |            \                         never paid; the
 *   completed   order created   pending (released)       sweep stops here)
 *
 * Legacy rows: payments created before snapshots existed have no row at all
 * until something reserves one, and no `snapshot`. Readers fall back to
 * provider metadata in that case; see `payment-recovery.ts`.
 */

const TABLE_NAME = 'maleq_payment_intent_orders';

/** Bump when the snapshot shape changes in a way readers must notice. */
const SNAPSHOT_VERSION = 1;

let ensureTablePromise: Promise<void> | null = null;

export type PaymentRecordStatus = 'pending' | 'processing' | 'completed' | 'abandoned';

export interface CheckoutSnapshotAddress {
  name: string | null;
  phone: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface CheckoutSnapshot {
  version: number;
  /** Compact cart tuples: [productId, variationId|null, qty, unitPrice]. */
  items: CompactCartItem[];
  pricing: {
    subtotal: number;
    shipping: number;
    discount: number;
    tax: number;
    total: number;
  };
  shippingMethod: { id: string; name: string };
  shippingCountry: string;
  shippingAddress: CheckoutSnapshotAddress | null;
  /** Integrity values `/api/orders/create` checks the submitted cart against. */
  fingerprint: string;
  customerRef: string;
  customerId: number | null;
  customerEmail: string | null;
  couponCode: string | null;
  createdAt: string;
}

export interface PaymentRecord {
  paymentIntentId: string;
  provider: string;
  orderId: number | null;
  status: PaymentRecordStatus;
  amountCents: number | null;
  currency: string;
  customerEmail: string | null;
  snapshot: CheckoutSnapshot | null;
  createdAt: Date;
}

export interface PaymentIntentReservation {
  acquired: boolean;
  orderId: number | null;
  status: PaymentRecordStatus;
}

interface PaymentRecordRow extends RowDataPacket {
  payment_intent_id: string;
  provider: string;
  order_id: number | null;
  status: PaymentRecordStatus;
  amount_cents: number | string | null;
  currency: string | null;
  customer_email: string | null;
  snapshot: string | null;
  created_at: Date;
}

/** Columns added after the table's first release, applied on demand. */
const ADDED_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: 'provider', definition: "VARCHAR(32) NOT NULL DEFAULT 'stripe'" },
  { name: 'amount_cents', definition: 'BIGINT UNSIGNED NULL' },
  { name: 'currency', definition: "VARCHAR(8) NOT NULL DEFAULT 'usd'" },
  { name: 'customer_email', definition: 'VARCHAR(255) NULL' },
  { name: 'snapshot', definition: 'LONGTEXT NULL' },
];

function isAccessDenied(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return (
    code === 'ER_TABLEACCESS_DENIED_ERROR' ||
    code === 'ER_DBACCESS_DENIED_ERROR' ||
    code === 'ER_ACCESS_DENIED_ERROR'
  );
}

async function ensureTable(): Promise<void> {
  if (ensureTablePromise) return ensureTablePromise;

  ensureTablePromise = (async () => {
    const pool = await getPoolAsync();
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          payment_intent_id VARCHAR(128) NOT NULL,
          provider VARCHAR(32) NOT NULL DEFAULT 'stripe',
          order_id BIGINT UNSIGNED NULL,
          status ENUM('pending', 'processing', 'completed', 'abandoned') NOT NULL DEFAULT 'pending',
          amount_cents BIGINT UNSIGNED NULL,
          currency VARCHAR(8) NOT NULL DEFAULT 'usd',
          customer_email VARCHAR(255) NULL,
          snapshot LONGTEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (payment_intent_id),
          KEY idx_order_id (order_id),
          KEY idx_status_created (status, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      // CREATE TABLE IF NOT EXISTS is a no-op on an existing table, so the
      // v1 schema (payment_intent_id/order_id/status only, with no 'pending'
      // in the enum) has to be upgraded in place. Idempotent: each step is
      // skipped when already applied. `docs/migrations/` carries the same DDL
      // to run by hand against production, which makes this a no-op there.
      await upgradeExistingTable(pool);
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      // Read-only DB user: the migration must have been applied out of band.
      await pool.query(`SELECT 1 FROM ${TABLE_NAME} LIMIT 1`);
    }
  })();

  try {
    await ensureTablePromise;
  } catch (error) {
    ensureTablePromise = null;
    throw error;
  }
}

type Pool = Awaited<ReturnType<typeof getPoolAsync>>;

async function upgradeExistingTable(pool: Pool): Promise<void> {
  const [columns] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [TABLE_NAME]
  );

  const existing = new Map(
    columns.map((row) => [String(row.name), String(row.type)])
  );

  for (const column of ADDED_COLUMNS) {
    if (existing.has(column.name)) continue;
    await pool.query(`ALTER TABLE ${TABLE_NAME} ADD COLUMN ${column.name} ${column.definition}`);
  }

  // Widen the status enum so create-intent can park a row in 'pending'.
  // Existing 'processing'/'completed' rows are untouched by the change.
  const statusType = existing.get('status') || '';
  if (statusType && !(statusType.includes("'pending'") && statusType.includes("'abandoned'"))) {
    await pool.query(
      `ALTER TABLE ${TABLE_NAME}
       MODIFY COLUMN status ENUM('pending', 'processing', 'completed', 'abandoned') NOT NULL DEFAULT 'pending'`
    );
  }

  const [indexes] = await pool.query<RowDataPacket[]>(
    `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'idx_status_created'`,
    [TABLE_NAME]
  );
  if (indexes.length === 0) {
    await pool.query(
      `ALTER TABLE ${TABLE_NAME} ADD KEY idx_status_created (status, created_at)`
    );
  }
}

function parseSnapshot(raw: string | null): CheckoutSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CheckoutSnapshot;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function mapRow(row: PaymentRecordRow): PaymentRecord {
  return {
    paymentIntentId: row.payment_intent_id,
    provider: row.provider || 'stripe',
    orderId: row.order_id ?? null,
    status: row.status,
    amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
    currency: row.currency || 'usd',
    customerEmail: row.customer_email ?? null,
    snapshot: parseSnapshot(row.snapshot),
    createdAt: row.created_at,
  };
}

/**
 * Persist the checkout snapshot for a freshly created payment.
 *
 * Called by `/api/payment/create-intent` immediately after the payment exists.
 * Throws on failure so the caller can fall back to writing cart data into
 * provider metadata — losing the snapshot silently would mean an unrecoverable
 * order if checkout then died.
 */
export async function recordCheckoutSnapshot(params: {
  paymentIntentId: string;
  provider: string;
  amountCents: number;
  currency: string;
  customerEmail?: string | null;
  snapshot: Omit<CheckoutSnapshot, 'version' | 'createdAt'>;
}): Promise<void> {
  await ensureTable();
  const pool = await getPoolAsync();

  const snapshot: CheckoutSnapshot = {
    ...params.snapshot,
    version: SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
  };

  await pool.execute(
    `INSERT INTO ${TABLE_NAME}
       (payment_intent_id, provider, status, amount_cents, currency, customer_email, snapshot)
     VALUES (?, ?, 'pending', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       amount_cents = VALUES(amount_cents),
       currency = VALUES(currency),
       customer_email = VALUES(customer_email),
       -- Only refresh the snapshot while the row is still unclaimed; a row
       -- that someone is already turning into an order must not shift under
       -- them. Payment IDs are unique per checkout so this is belt-and-braces.
       snapshot = IF(status = 'pending', VALUES(snapshot), snapshot)`,
    [
      params.paymentIntentId,
      params.provider,
      params.amountCents,
      params.currency,
      params.customerEmail || null,
      JSON.stringify(snapshot),
    ]
  );
}

export async function getPaymentRecord(paymentIntentId: string): Promise<PaymentRecord | null> {
  await ensureTable();
  const pool = await getPoolAsync();
  const [rows] = await pool.execute<PaymentRecordRow[]>(
    `SELECT payment_intent_id, provider, order_id, status, amount_cents, currency,
            customer_email, snapshot, created_at
     FROM ${TABLE_NAME}
     WHERE payment_intent_id = ?
     LIMIT 1`,
    [paymentIntentId]
  );

  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Read the current reservation without acquiring it.
 *
 * This is the authoritative "does a WooCommerce order already exist / is one
 * being created right now for this payment?" check. `/api/orders/create`
 * takes the lock *before* calling WooCommerce and stamps `order_id` after, so
 * the webhook can tell "checkout is mid-flight" apart from "checkout never
 * ran" — a distinction provider metadata cannot express, because the order ID
 * is only written there once the order already exists.
 */
export async function lookupPaymentIntentReservation(
  paymentIntentId: string
): Promise<PaymentIntentReservation | null> {
  const record = await getPaymentRecord(paymentIntentId);
  if (!record) return null;
  return { acquired: false, orderId: record.orderId, status: record.status };
}

/**
 * Take the lock for turning this payment into an order.
 *
 * `abandoned` is claimable as well as `pending`: a customer who returns and
 * completes a payment we had written off must still get an order.
 *
 * Two paths, because a row may or may not already exist:
 *   - snapshot row present: compare-and-swap to `processing`. InnoDB
 *     applies the row lock, so exactly one concurrent caller sees a match.
 *   - no row (payment predates snapshots, or the snapshot write failed):
 *     INSERT and let the primary key decide the winner.
 *
 * A caller that does not acquire must stand down entirely — the holder either
 * completes the order or releases the lock for a later retry.
 */
export async function reservePaymentIntent(
  paymentIntentId: string
): Promise<PaymentIntentReservation> {
  await ensureTable();
  const pool = await getPoolAsync();

  const [claim] = await pool.execute<ResultSetHeader>(
    `UPDATE ${TABLE_NAME}
     SET status = 'processing'
     WHERE payment_intent_id = ? AND status IN ('pending', 'abandoned')`,
    [paymentIntentId]
  );

  if (claim.affectedRows === 1) {
    return { acquired: true, orderId: null, status: 'processing' };
  }

  try {
    await pool.execute(
      `INSERT INTO ${TABLE_NAME} (payment_intent_id, status)
       VALUES (?, 'processing')`,
      [paymentIntentId]
    );
    return { acquired: true, orderId: null, status: 'processing' };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'ER_DUP_ENTRY') throw error;

    // Someone else holds it (or already finished). Report their state.
    return (
      (await lookupPaymentIntentReservation(paymentIntentId)) || {
        acquired: false,
        orderId: null,
        status: 'processing',
      }
    );
  }
}

export async function markPaymentIntentOrderComplete(
  paymentIntentId: string,
  orderId: number
): Promise<void> {
  await ensureTable();
  const pool = await getPoolAsync();
  await pool.execute(
    `UPDATE ${TABLE_NAME}
     SET order_id = ?, status = 'completed'
     WHERE payment_intent_id = ?`,
    [orderId, paymentIntentId]
  );
}

/**
 * Hand the lock back after a failed attempt.
 *
 * Reverts to `pending` rather than deleting the row, which is the change that
 * makes the snapshot useful: the cart survives a failed attempt, so the
 * reconciliation cron can retry from real line items instead of falling back
 * to an "items unknown" placeholder. Rows with no snapshot (legacy payments)
 * are deleted as before, since an empty `pending` row carries no information.
 */
export async function releasePaymentIntentReservation(paymentIntentId: string): Promise<void> {
  await ensureTable();
  const pool = await getPoolAsync();
  await pool.execute(
    `UPDATE ${TABLE_NAME}
     SET status = 'pending'
     WHERE payment_intent_id = ?
       AND order_id IS NULL
       AND status = 'processing'
       AND snapshot IS NOT NULL`,
    [paymentIntentId]
  );
  await pool.execute(
    `DELETE FROM ${TABLE_NAME}
     WHERE payment_intent_id = ?
       AND order_id IS NULL
       AND status = 'processing'
       AND snapshot IS NULL`,
    [paymentIntentId]
  );
}

/**
 * Mark a checkout the customer never paid for, so the reconciliation sweep
 * stops re-checking it against the processor every 15 minutes.
 *
 * Not a terminal state in the strict sense — `reservePaymentIntent` will still
 * claim an abandoned row — because a late payment on an old intent must still
 * produce an order.
 */
export async function markPaymentAbandoned(paymentIntentId: string): Promise<void> {
  await ensureTable();
  const pool = await getPoolAsync();
  await pool.execute(
    `UPDATE ${TABLE_NAME}
     SET status = 'abandoned'
     WHERE payment_intent_id = ?
       AND order_id IS NULL
       AND status = 'pending'`,
    [paymentIntentId]
  );
}

/**
 * Candidates for the reconciliation sweep: payments we started but never
 * turned into an order.
 *
 * Replaces paging the processor's payment list. We only surface rows old
 * enough that no in-flight request could still own them; the caller still has
 * to ask the processor whether the payment actually succeeded, since that is
 * the one fact this table does not know.
 */
export async function findUnreconciledPayments(params: {
  minAgeMs: number;
  maxAgeMs: number;
  limit?: number;
}): Promise<PaymentRecord[]> {
  await ensureTable();
  const pool = await getPoolAsync();
  const limit = Math.max(1, Math.min(params.limit ?? 100, 500));

  const [rows] = await pool.query<PaymentRecordRow[]>(
    `SELECT payment_intent_id, provider, order_id, status, amount_cents, currency,
            customer_email, snapshot, created_at
     FROM ${TABLE_NAME}
     WHERE order_id IS NULL
       AND status IN ('pending', 'processing')
       AND created_at <= DATE_SUB(NOW(), INTERVAL ? SECOND)
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)
     ORDER BY created_at ASC
     LIMIT ?`,
    [
      Math.floor(params.minAgeMs / 1000),
      Math.floor(params.maxAgeMs / 1000),
      limit,
    ]
  );

  return rows.map(mapRow);
}
