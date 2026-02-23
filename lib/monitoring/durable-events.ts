import { getPoolAsync } from '@/lib/db/pool';

type EventSeverity = 'info' | 'warning' | 'error';

export interface DurableEventInput {
  eventType: string;
  message: string;
  severity?: EventSeverity;
  eventId?: string | null;
  paymentIntentId?: string | null;
  orderId?: number | null;
  requestPath?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
  payload?: unknown;
}

let ensureTablePromise: Promise<void> | null = null;

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

async function ensureEventLogTable(): Promise<void> {
  if (ensureTablePromise) return ensureTablePromise;

  ensureTablePromise = (async () => {
    const pool = await getPoolAsync();
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS maleq_event_log (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_type VARCHAR(64) NOT NULL,
        event_source VARCHAR(32) NOT NULL DEFAULT 'nextjs',
        severity ENUM('info', 'warning', 'error') NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        event_id VARCHAR(128) NULL,
        payment_intent_id VARCHAR(128) NULL,
        order_id BIGINT NULL,
        request_path VARCHAR(255) NULL,
        ip VARCHAR(64) NULL,
        user_agent VARCHAR(512) NULL,
        referrer VARCHAR(1024) NULL,
        payload_json LONGTEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_event_type_created (event_type, created_at),
        KEY idx_payment_intent (payment_intent_id),
        KEY idx_event_id (event_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  })();

  try {
    await ensureTablePromise;
  } catch (error) {
    ensureTablePromise = null;
    throw error;
  }
}

export async function logDurableEvent(input: DurableEventInput): Promise<void> {
  try {
    await ensureEventLogTable();
    const pool = await getPoolAsync();

    const payloadJson =
      input.payload === undefined ? null : JSON.stringify(input.payload);

    await pool.execute(
      `INSERT INTO maleq_event_log
        (event_type, event_source, severity, message, event_id, payment_intent_id, order_id, request_path, ip, user_agent, referrer, payload_json)
       VALUES (?, 'nextjs', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        truncate(input.eventType, 64) || 'unknown_event',
        input.severity || 'info',
        input.message,
        truncate(input.eventId, 128),
        truncate(input.paymentIntentId, 128),
        input.orderId ?? null,
        truncate(input.requestPath, 255),
        truncate(input.ip, 64),
        truncate(input.userAgent, 512),
        truncate(input.referrer, 1024),
        payloadJson,
      ]
    );
  } catch (error) {
    // Never let logging failures break request flow.
    console.error('[durable-events] Failed to persist event log:', error);
  }
}
