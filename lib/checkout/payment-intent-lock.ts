import type { RowDataPacket } from 'mysql2';
import { getPoolAsync } from '@/lib/db/pool';

const TABLE_NAME = 'maleq_payment_intent_orders';

let ensureTablePromise: Promise<void> | null = null;

interface PaymentIntentOrderRow extends RowDataPacket {
  payment_intent_id: string;
  order_id: number | null;
  status: 'processing' | 'completed';
}

export interface PaymentIntentReservation {
  acquired: boolean;
  orderId: number | null;
  status: 'processing' | 'completed';
}

async function ensureTable(): Promise<void> {
  if (ensureTablePromise) return ensureTablePromise;

  ensureTablePromise = (async () => {
    const pool = await getPoolAsync();
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          payment_intent_id VARCHAR(128) NOT NULL,
          order_id BIGINT UNSIGNED NULL,
          status ENUM('processing', 'completed') NOT NULL DEFAULT 'processing',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (payment_intent_id),
          KEY idx_order_id (order_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const createDenied =
        code === 'ER_TABLEACCESS_DENIED_ERROR' ||
        code === 'ER_DBACCESS_DENIED_ERROR' ||
        code === 'ER_ACCESS_DENIED_ERROR';

      if (!createDenied) throw error;
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

async function getReservation(paymentIntentId: string): Promise<PaymentIntentReservation | null> {
  const pool = await getPoolAsync();
  const [rows] = await pool.execute<PaymentIntentOrderRow[]>(
    `SELECT payment_intent_id, order_id, status
     FROM ${TABLE_NAME}
     WHERE payment_intent_id = ?
     LIMIT 1`,
    [paymentIntentId]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    acquired: false,
    orderId: row.order_id ?? null,
    status: row.status,
  };
}

export async function reservePaymentIntent(
  paymentIntentId: string
): Promise<PaymentIntentReservation> {
  await ensureTable();
  const pool = await getPoolAsync();

  try {
    await pool.execute(
      `INSERT INTO ${TABLE_NAME} (payment_intent_id, status)
       VALUES (?, 'processing')`,
      [paymentIntentId]
    );

    return {
      acquired: true,
      orderId: null,
      status: 'processing',
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'ER_DUP_ENTRY') throw error;

    return (
      (await getReservation(paymentIntentId)) || {
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

export async function releasePaymentIntentReservation(paymentIntentId: string): Promise<void> {
  await ensureTable();
  const pool = await getPoolAsync();
  await pool.execute(
    `DELETE FROM ${TABLE_NAME}
     WHERE payment_intent_id = ?
       AND order_id IS NULL
       AND status = 'processing'`,
    [paymentIntentId]
  );
}
