import nodemailer from 'nodemailer';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPoolAsync } from '@/lib/db/pool';

const TABLE_NAME = 'maleq_stock_alert_email_subscriptions';
const DEFAULT_FROM_EMAIL = 'info@maleq.com';

let ensureTablePromise: Promise<void> | null = null;

export interface EmailStockAlertSubscriptionInput {
  email: string;
  productId: number;
  productName: string;
  productSlug: string;
}

export interface EmailStockAlertRunResult {
  sent: number;
  failed: number;
  pending: number;
  skipped: number;
}

interface PendingEmailAlertRow extends RowDataPacket {
  id: number;
  email: string;
  product_id: number;
  product_name: string;
  product_slug: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTransporter(): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: 'smtp.mail.me.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USERNAME,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

function canSendEmailAlerts(): boolean {
  return Boolean(process.env.SMTP_USERNAME && process.env.SMTP_PASSWORD);
}

async function ensureEmailAlertTable(): Promise<void> {
  if (ensureTablePromise) return ensureTablePromise;

  ensureTablePromise = (async () => {
    const pool = await getPoolAsync();
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          email VARCHAR(255) NOT NULL,
          product_id BIGINT UNSIGNED NOT NULL,
          product_name VARCHAR(255) NOT NULL,
          product_slug VARCHAR(255) NOT NULL,
          notified_at TIMESTAMP NULL DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_email_product (email, product_id),
          KEY idx_product_notified (product_id, notified_at),
          KEY idx_notified (notified_at)
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

export async function saveEmailStockAlertSubscription(
  input: EmailStockAlertSubscriptionInput
): Promise<void> {
  await ensureEmailAlertTable();
  const pool = await getPoolAsync();
  await pool.execute<ResultSetHeader>(
    `INSERT INTO ${TABLE_NAME}
      (email, product_id, product_name, product_slug, notified_at)
     VALUES (?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
      product_name = VALUES(product_name),
      product_slug = VALUES(product_slug),
      notified_at = NULL`,
    [
      normalizeEmail(input.email),
      input.productId,
      truncate(input.productName, 255),
      truncate(input.productSlug, 255),
    ]
  );
}

export async function deleteEmailStockAlertSubscription(
  productId: number,
  email: string
): Promise<void> {
  await ensureEmailAlertTable();
  const pool = await getPoolAsync();
  await pool.execute<ResultSetHeader>(
    `DELETE FROM ${TABLE_NAME} WHERE product_id = ? AND email = ?`,
    [productId, normalizeEmail(email)]
  );
}

export async function checkAndSendEmailStockAlerts(): Promise<EmailStockAlertRunResult> {
  await ensureEmailAlertTable();
  const pool = await getPoolAsync();

  const [rows] = await pool.execute<PendingEmailAlertRow[]>(
    `SELECT a.id, a.email, a.product_id, a.product_name, a.product_slug
     FROM ${TABLE_NAME} a
     INNER JOIN wp_postmeta pm
       ON pm.post_id = a.product_id
      AND pm.meta_key = '_stock_status'
     WHERE a.notified_at IS NULL
       AND pm.meta_value = 'instock'`
  );

  const pending = rows.length;
  if (pending === 0) {
    return { sent: 0, failed: 0, pending: 0, skipped: 0 };
  }

  if (!canSendEmailAlerts()) {
    return { sent: 0, failed: 0, pending, skipped: pending };
  }

  const transporter = getTransporter();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';
  const fromAddress = process.env.STOCK_ALERT_FROM_EMAIL || DEFAULT_FROM_EMAIL;

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const productUrl = `${siteUrl.replace(/\/+$/, '')}/product/${row.product_slug}`;

    try {
      await transporter.sendMail({
        from: `"Male Q" <${fromAddress}>`,
        to: row.email,
        subject: `${row.product_name} is back in stock`,
        text: [
          `Good news — ${row.product_name} is available again.`,
          '',
          `View product: ${productUrl}`,
          '',
          'You are receiving this because you requested a stock alert.',
        ].join('\n'),
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;">
            <h2 style="margin-bottom:12px;">${escapeHtml(row.product_name)} is back in stock</h2>
            <p style="margin-bottom:16px;">Good news, the item you asked about is available again.</p>
            <p style="margin-bottom:20px;">
              <a href="${productUrl}" style="display:inline-block;padding:10px 14px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">
                View Product
              </a>
            </p>
            <p style="font-size:12px;color:#666;">
              You are receiving this because you requested a stock alert on Male Q.
            </p>
          </div>
        `,
      });

      await pool.execute<ResultSetHeader>(
        `UPDATE ${TABLE_NAME} SET notified_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [row.id]
      );
      sent++;
    } catch (error) {
      failed++;
      console.error('Failed to send stock alert email:', row.id, error);
    }
  }

  return {
    sent,
    failed,
    pending,
    skipped: 0,
  };
}
