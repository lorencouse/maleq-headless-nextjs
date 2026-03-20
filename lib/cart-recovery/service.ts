import crypto from 'crypto';
import nodemailer from 'nodemailer';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Cart, CartItem } from '@/lib/types/cart';
import { getPoolAsync } from '@/lib/db/pool';

const TABLE_NAME = 'maleq_abandoned_carts';
const FRONTEND_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com').replace(/\/$/, '');
const RECOVERY_DELAY_MINUTES = Number(process.env.CART_RECOVERY_DELAY_MINUTES || 60);
const MAX_RECOVERY_EMAILS = Number(process.env.CART_RECOVERY_MAX_EMAILS || 1);
const CART_RECOVERY_FROM_EMAIL = process.env.CART_RECOVERY_FROM_EMAIL || 'sales@maleq.com';
const CART_RECOVERY_FROM_NAME = process.env.CART_RECOVERY_FROM_NAME || 'Male Q';
const CART_RECOVERY_EMAIL_TIMEOUT_MS = Number(process.env.CART_RECOVERY_EMAIL_TIMEOUT_MS || 5000);

let ensureTablePromise: Promise<void> | null = null;
let transporter: nodemailer.Transporter | null = null;

interface RecoveryCartRow extends RowDataPacket {
  id: number;
  cart_key: string;
  email: string;
  customer_id: number | null;
  status: 'active' | 'recovered' | 'converted' | 'cancelled';
  items_json: string;
  totals_json: string;
  item_count: number;
  subtotal: string;
  total: string;
  currency: string;
  coupon_code: string | null;
  shipping_method_id: string | null;
  shipping_method_name: string | null;
  shipping_country: string | null;
  checkout_url: string | null;
  payment_intent_id: string | null;
  email_send_count: number;
  last_email_sent_at: string | null;
  next_email_at: string | null;
  last_email_error: string | null;
  recovered_at: string | null;
  converted_at: string | null;
  order_id: number | null;
  last_seen_at: string;
}

export interface CartRecoverySnapshotInput {
  cartKey: string;
  email: string;
  customerId?: number | null;
  cart: Cart;
  shippingMethodId?: string | null;
  shippingMethodName?: string | null;
  shippingCountry?: string | null;
  checkoutUrl?: string | null;
  paymentIntentId?: string | null;
}

export interface RestoredCartPayload {
  cartKey: string;
  cart: Cart;
  email: string;
}

export interface CartRecoveryEmailResult {
  sent: number;
  failed: number;
  skipped: number;
}

function getRecoverySecret(): string {
  const secret =
    process.env.CART_RECOVERY_SECRET ||
    process.env.ADMIN_API_KEY ||
    process.env.STRIPE_SECRET_KEY ||
    '';

  if (!secret) {
    throw new Error('Cart recovery secret is not configured');
  }

  return secret;
}

function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_USERNAME && process.env.SMTP_PASSWORD);
}

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.mail.me.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USERNAME,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }

  return transporter;
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toMySqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function minutesFromNow(minutes: number): string {
  return toMySqlDateTime(new Date(Date.now() + minutes * 60 * 1000));
}

function sanitizeRelativePath(path: string | null | undefined): string {
  if (!path) return '/checkout';
  return path.startsWith('/') ? path.slice(0, 255) : '/checkout';
}

function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

function stableCart(input: Cart): Cart {
  const items = Array.isArray(input.items) ? input.items : [];
  return {
    items,
    subtotal: Number(input.subtotal || 0),
    tax: Number(input.tax || 0),
    shipping: Number(input.shipping || 0),
    discount: Number(input.discount || 0),
    autoDiscount: Number(input.autoDiscount || 0),
    autoDiscountLabel: input.autoDiscountLabel || undefined,
    total: Number(input.total || 0),
    itemCount: Number(input.itemCount || items.reduce((sum, item) => sum + item.quantity, 0)),
    currency: input.currency || 'USD',
    couponCode: input.couponCode || undefined,
    updatedAt: Number(input.updatedAt || Date.now()),
  };
}

function parseCartJson(itemsJson: string, totalsJson: string): Cart {
  const items = JSON.parse(itemsJson) as CartItem[];
  const totals = JSON.parse(totalsJson) as Omit<Cart, 'items'>;
  return stableCart({
    ...totals,
    items,
  });
}

async function ensureCartRecoveryTable(): Promise<void> {
  if (ensureTablePromise) return ensureTablePromise;

  ensureTablePromise = (async () => {
    const pool = await getPoolAsync();
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          cart_key VARCHAR(64) NOT NULL,
          email VARCHAR(255) NOT NULL,
          customer_id BIGINT NULL,
          status ENUM('active', 'recovered', 'converted', 'cancelled') NOT NULL DEFAULT 'active',
          items_json LONGTEXT NOT NULL,
          totals_json LONGTEXT NOT NULL,
          item_count INT UNSIGNED NOT NULL DEFAULT 0,
          subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
          total DECIMAL(10,2) NOT NULL DEFAULT 0,
          currency VARCHAR(8) NOT NULL DEFAULT 'USD',
          coupon_code VARCHAR(100) NULL,
          shipping_method_id VARCHAR(64) NULL,
          shipping_method_name VARCHAR(255) NULL,
          shipping_country VARCHAR(8) NULL,
          checkout_url VARCHAR(255) NULL,
          payment_intent_id VARCHAR(128) NULL,
          email_send_count INT UNSIGNED NOT NULL DEFAULT 0,
          last_email_sent_at DATETIME NULL,
          next_email_at DATETIME NULL,
          last_email_error TEXT NULL,
          recovered_at DATETIME NULL,
          converted_at DATETIME NULL,
          order_id BIGINT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          last_seen_at DATETIME NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_cart_key (cart_key),
          KEY idx_status_next_email (status, next_email_at),
          KEY idx_email_status (email, status),
          KEY idx_payment_intent (payment_intent_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const createDenied =
        code === 'ER_TABLEACCESS_DENIED_ERROR' ||
        code === 'ER_DBACCESS_DENIED_ERROR' ||
        code === 'ER_ACCESS_DENIED_ERROR';

      if (!createDenied) {
        throw error;
      }

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

function buildRecoverySignature(id: number, email: string): string {
  return crypto
    .createHmac('sha256', getRecoverySecret())
    .update(`${id}:${normalizeEmail(email)}`)
    .digest('base64url');
}

function buildRecoveryToken(id: number, email: string): string {
  return `${id}.${buildRecoverySignature(id, email)}`;
}

function buildRecoveryUrl(token: string): string {
  return `${FRONTEND_URL}/cart?recovery=${encodeURIComponent(token)}`;
}

function parseRecoveryToken(token: string): { id: number; signature: string } | null {
  const [idPart, signature] = token.split('.');
  if (!idPart || !signature) return null;
  const id = Number(idPart);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { id, signature };
}

function signaturesMatch(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Cart recovery email timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function buildRecoveryEmailHtml(cart: Cart, recoveryUrl: string): string {
  const itemsHtml = cart.items
    .slice(0, 8)
    .map((item) => {
      const attributes = item.attributes
        ? Object.entries(item.attributes)
            .map(([key, value]) => `${key}: ${value}`)
            .join(' | ')
        : '';

      return `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
            <div style="font-weight: 600; color: #111827;">${item.name}</div>
            <div style="font-size: 13px; color: #6b7280;">Qty ${item.quantity}${attributes ? ` | ${attributes}` : ''}</div>
          </td>
          <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right; white-space: nowrap;">
            ${formatCurrency(item.subtotal, cart.currency)}
          </td>
        </tr>
      `;
    })
    .join('');

  const couponRow = cart.couponCode
    ? `<p style="margin: 8px 0 0; color: #4b5563;">Coupon applied: <strong>${cart.couponCode}</strong></p>`
    : '';

  const shippingRow = cart.shipping > 0
    ? `<p style="margin: 8px 0 0; color: #4b5563;">Shipping: ${formatCurrency(cart.shipping, cart.currency)}</p>`
    : '';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; color: #111827;">
      <div style="padding: 24px; border: 1px solid #e5e7eb; border-radius: 16px; background: #ffffff;">
        <p style="margin: 0 0 12px; font-size: 14px; color: #6b7280;">Still thinking it over?</p>
        <h1 style="margin: 0 0 16px; font-size: 28px; line-height: 1.2;">Your cart is still waiting.</h1>
        <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #374151;">
          We saved the items you left behind. Use the button below to restore your cart and continue checkout.
        </p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0 12px;">
          ${itemsHtml}
        </table>

        <div style="margin: 20px 0; padding: 16px; border-radius: 12px; background: #f9fafb;">
          <p style="margin: 0; font-size: 14px; color: #4b5563;">Order total</p>
          <p style="margin: 6px 0 0; font-size: 24px; font-weight: 700;">${formatCurrency(cart.total, cart.currency)}</p>
          ${shippingRow}
          ${couponRow}
        </div>

        <p style="margin: 24px 0;">
          <a href="${recoveryUrl}" style="display: inline-block; padding: 14px 22px; border-radius: 999px; background: #111827; color: #ffffff; text-decoration: none; font-weight: 600;">
            Restore My Cart
          </a>
        </p>

        <p style="margin: 0; font-size: 13px; color: #6b7280;">
          If you already placed this order, you can ignore this email.
        </p>
      </div>
    </div>
  `;
}

async function sendRecoveryEmail(row: RecoveryCartRow, recoveryUrl: string, cart: Cart): Promise<void> {
  if (!isEmailConfigured()) {
    throw new Error('SMTP credentials are not configured');
  }

  const subject =
    cart.items.length === 1
      ? `You left ${cart.items[0].name} in your cart`
      : 'You left something in your cart';

  await withTimeout(
    getTransporter().sendMail({
      from: `"${CART_RECOVERY_FROM_NAME}" <${CART_RECOVERY_FROM_EMAIL}>`,
      to: row.email,
      subject,
      html: buildRecoveryEmailHtml(cart, recoveryUrl),
    }),
    CART_RECOVERY_EMAIL_TIMEOUT_MS
  );
}

export async function upsertCartRecoverySnapshot(
  input: CartRecoverySnapshotInput
): Promise<void> {
  await ensureCartRecoveryTable();

  const pool = await getPoolAsync();
  const cart = stableCart(input.cart);
  const itemsJson = JSON.stringify(cart.items);
  const totalsJson = JSON.stringify({
    subtotal: cart.subtotal,
    tax: cart.tax,
    shipping: cart.shipping,
    discount: cart.discount,
    autoDiscount: cart.autoDiscount,
    autoDiscountLabel: cart.autoDiscountLabel,
    total: cart.total,
    itemCount: cart.itemCount,
    currency: cart.currency,
    couponCode: cart.couponCode,
    updatedAt: cart.updatedAt,
  });

  const nextEmailAt = minutesFromNow(RECOVERY_DELAY_MINUTES);
  const normalizedEmail = normalizeEmail(input.email);
  const lastSeenAt = toMySqlDateTime(new Date());

  await pool.execute(
    `INSERT INTO ${TABLE_NAME}
      (cart_key, email, customer_id, status, items_json, totals_json, item_count, subtotal, total, currency, coupon_code, shipping_method_id, shipping_method_name, shipping_country, checkout_url, payment_intent_id, email_send_count, last_email_sent_at, next_email_at, last_email_error, recovered_at, converted_at, order_id, last_seen_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, NULL, NULL, NULL, ?)
     ON DUPLICATE KEY UPDATE
      email = VALUES(email),
      customer_id = VALUES(customer_id),
      status = 'active',
      items_json = VALUES(items_json),
      totals_json = VALUES(totals_json),
      item_count = VALUES(item_count),
      subtotal = VALUES(subtotal),
      total = VALUES(total),
      currency = VALUES(currency),
      coupon_code = VALUES(coupon_code),
      shipping_method_id = VALUES(shipping_method_id),
      shipping_method_name = VALUES(shipping_method_name),
      shipping_country = VALUES(shipping_country),
      checkout_url = VALUES(checkout_url),
      payment_intent_id = COALESCE(VALUES(payment_intent_id), payment_intent_id),
      email_send_count = CASE
        WHEN status = 'converted' THEN 0
        ELSE email_send_count
      END,
      last_email_sent_at = CASE
        WHEN status = 'converted' THEN NULL
        ELSE last_email_sent_at
      END,
      next_email_at = CASE
        WHEN status = 'converted' OR email_send_count = 0 THEN VALUES(next_email_at)
        ELSE next_email_at
      END,
      last_email_error = NULL,
      recovered_at = NULL,
      converted_at = CASE
        WHEN status = 'converted' THEN NULL
        ELSE converted_at
      END,
      order_id = CASE
        WHEN status = 'converted' THEN NULL
        ELSE order_id
      END,
      last_seen_at = VALUES(last_seen_at)`,
    [
      truncate(input.cartKey, 64) || crypto.randomUUID().replace(/-/g, '').slice(0, 64),
      truncate(normalizedEmail, 255),
      input.customerId ?? null,
      itemsJson,
      totalsJson,
      cart.itemCount,
      cart.subtotal.toFixed(2),
      cart.total.toFixed(2),
      truncate(cart.currency, 8) || 'USD',
      truncate(cart.couponCode, 100),
      truncate(input.shippingMethodId, 64),
      truncate(input.shippingMethodName, 255),
      truncate(input.shippingCountry, 8),
      sanitizeRelativePath(input.checkoutUrl),
      truncate(input.paymentIntentId, 128),
      nextEmailAt,
      lastSeenAt,
    ]
  );
}

export async function restoreCartByRecoveryToken(
  token: string
): Promise<RestoredCartPayload | null> {
  await ensureCartRecoveryTable();

  const parsed = parseRecoveryToken(token);
  if (!parsed) {
    return null;
  }

  const pool = await getPoolAsync();
  const [rows] = await pool.query<RecoveryCartRow[]>(
    `SELECT *
     FROM ${TABLE_NAME}
     WHERE id = ?
       AND status IN ('active', 'recovered')
     LIMIT 1`,
    [parsed.id]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  const expectedSignature = buildRecoverySignature(row.id, row.email);
  if (!signaturesMatch(parsed.signature, expectedSignature)) {
    return null;
  }

  const cart = parseCartJson(row.items_json, row.totals_json);

  await pool.execute(
    `UPDATE ${TABLE_NAME}
     SET status = 'recovered',
         recovered_at = COALESCE(recovered_at, UTC_TIMESTAMP()),
         next_email_at = NULL,
         last_seen_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [row.id]
  );

  return {
    cartKey: row.cart_key,
    cart,
    email: row.email,
  };
}

export async function markCartRecoveryConverted(input: {
  paymentIntentId?: string | null;
  email?: string | null;
  orderId: number;
}): Promise<void> {
  await ensureCartRecoveryTable();

  const pool = await getPoolAsync();

  if (input.paymentIntentId) {
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE ${TABLE_NAME}
       SET status = 'converted',
           converted_at = UTC_TIMESTAMP(),
           order_id = ?,
           next_email_at = NULL
       WHERE payment_intent_id = ?
         AND status IN ('active', 'recovered')`,
      [input.orderId, truncate(input.paymentIntentId, 128)]
    );

    if (result.affectedRows > 0) {
      return;
    }
  }

  if (!input.email) {
    return;
  }

  await pool.execute(
    `UPDATE ${TABLE_NAME}
     SET status = 'converted',
         converted_at = UTC_TIMESTAMP(),
         order_id = ?,
         next_email_at = NULL
     WHERE email = ?
       AND status IN ('active', 'recovered')
     ORDER BY id DESC
     LIMIT 1`,
    [input.orderId, truncate(normalizeEmail(input.email), 255)]
  );
}

export async function sendDueCartRecoveryEmails(): Promise<CartRecoveryEmailResult> {
  await ensureCartRecoveryTable();

  if (!isEmailConfigured()) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const pool = await getPoolAsync();
  const [rows] = await pool.query<RecoveryCartRow[]>(
    `SELECT *
     FROM ${TABLE_NAME}
     WHERE status = 'active'
       AND next_email_at IS NOT NULL
       AND next_email_at <= UTC_TIMESTAMP()
       AND email_send_count < ?
       AND item_count > 0
     ORDER BY next_email_at ASC
     LIMIT 100`,
    [MAX_RECOVERY_EMAILS]
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    let cart: Cart;
    try {
      cart = parseCartJson(row.items_json, row.totals_json);
    } catch (error) {
      failed += 1;
      await pool.execute(
        `UPDATE ${TABLE_NAME}
         SET last_email_error = ?,
             next_email_at = NULL
         WHERE id = ?`,
        [truncate(error instanceof Error ? error.message : String(error), 1000), row.id]
      );
      continue;
    }

    if (cart.items.length === 0) {
      skipped += 1;
      await pool.execute(
        `UPDATE ${TABLE_NAME}
         SET status = 'cancelled',
             next_email_at = NULL
         WHERE id = ?`,
        [row.id]
      );
      continue;
    }

    const recoveryToken = buildRecoveryToken(row.id, row.email);
    const recoveryUrl = buildRecoveryUrl(recoveryToken);

    try {
      await sendRecoveryEmail(row, recoveryUrl, cart);
      sent += 1;
      await pool.execute(
        `UPDATE ${TABLE_NAME}
         SET email_send_count = email_send_count + 1,
             last_email_sent_at = UTC_TIMESTAMP(),
             next_email_at = NULL,
             last_email_error = NULL
         WHERE id = ?`,
        [row.id]
      );
    } catch (error) {
      failed += 1;
      await pool.execute(
        `UPDATE ${TABLE_NAME}
         SET last_email_error = ?,
             next_email_at = NULL
         WHERE id = ?`,
        [truncate(error instanceof Error ? error.message : String(error), 1000), row.id]
      );
    }
  }

  return { sent, failed, skipped };
}
