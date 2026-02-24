import crypto from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPoolAsync } from '@/lib/db/pool';

type SyncStatus = 'pending' | 'synced' | 'failed' | 'skipped';
type ProviderName = 'mailchimp' | 'webhook';

export interface NewsletterSubscribeInput {
  email: string;
  source: string;
  ip?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
}

export interface NewsletterSubscribeResult {
  created: boolean;
  syncStatus: SyncStatus;
  provider: ProviderName | null;
  providerSubscriberId: string | null;
  providerListId: string | null;
  syncError: string | null;
}

interface ProviderSyncResult {
  provider: ProviderName;
  providerSubscriberId: string | null;
  providerListId: string | null;
}

interface ProviderConfigMailchimp {
  provider: 'mailchimp';
  apiKey: string;
  audienceId: string;
  serverPrefix: string;
}

interface ProviderConfigWebhook {
  provider: 'webhook';
  url: string;
  bearerToken: string | null;
}

type ProviderConfig = ProviderConfigMailchimp | ProviderConfigWebhook;

let ensureTablePromise: Promise<void> | null = null;

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function resolveProviderConfig(): ProviderConfig | null {
  const configured = (process.env.NEWSLETTER_PROVIDER || '').trim().toLowerCase();

  if (configured === 'none') {
    return null;
  }

  const mailchimpApiKey = (process.env.MAILCHIMP_API_KEY || '').trim();
  const mailchimpAudienceId = (process.env.MAILCHIMP_AUDIENCE_ID || '').trim();
  const mailchimpServerPrefix =
    (process.env.MAILCHIMP_SERVER_PREFIX || '').trim() ||
    mailchimpApiKey.split('-')[1] ||
    '';

  const webhookUrl = (process.env.NEWSLETTER_WEBHOOK_URL || '').trim();
  const webhookBearerToken = (process.env.NEWSLETTER_WEBHOOK_BEARER_TOKEN || '').trim() || null;

  if (configured === 'mailchimp') {
    if (!mailchimpApiKey || !mailchimpAudienceId || !mailchimpServerPrefix) return null;
    return {
      provider: 'mailchimp',
      apiKey: mailchimpApiKey,
      audienceId: mailchimpAudienceId,
      serverPrefix: mailchimpServerPrefix,
    };
  }

  if (configured === 'webhook') {
    if (!webhookUrl) return null;
    return {
      provider: 'webhook',
      url: webhookUrl,
      bearerToken: webhookBearerToken,
    };
  }

  if (mailchimpApiKey && mailchimpAudienceId && mailchimpServerPrefix) {
    return {
      provider: 'mailchimp',
      apiKey: mailchimpApiKey,
      audienceId: mailchimpAudienceId,
      serverPrefix: mailchimpServerPrefix,
    };
  }

  if (webhookUrl) {
    return {
      provider: 'webhook',
      url: webhookUrl,
      bearerToken: webhookBearerToken,
    };
  }

  return null;
}

function subscriberHash(email: string): string {
  return crypto.createHash('md5').update(email).digest('hex');
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function syncToMailchimp(
  config: ProviderConfigMailchimp,
  input: NewsletterSubscribeInput
): Promise<ProviderSyncResult> {
  const email = normalizeEmail(input.email);
  const hash = subscriberHash(email);
  const endpoint = `https://${config.serverPrefix}.api.mailchimp.com/3.0/lists/${encodeURIComponent(config.audienceId)}/members/${hash}`;

  const payload = {
    email_address: email,
    status_if_new: 'subscribed',
    status: 'subscribed',
    tags: [`source:${input.source}`],
  };

  const authorization = `Basic ${Buffer.from(`anystring:${config.apiKey}`).toString('base64')}`;

  const response = await fetchWithTimeout(endpoint, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Mailchimp sync failed (${response.status}): ${bodyText.slice(0, 240)}`);
  }

  const responseBody = (await response.json()) as { id?: string };

  return {
    provider: 'mailchimp',
    providerSubscriberId: responseBody.id || hash,
    providerListId: config.audienceId,
  };
}

async function syncToWebhook(
  config: ProviderConfigWebhook,
  input: NewsletterSubscribeInput
): Promise<ProviderSyncResult> {
  const response = await fetchWithTimeout(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.bearerToken ? { Authorization: `Bearer ${config.bearerToken}` } : {}),
    },
    body: JSON.stringify({
      email: normalizeEmail(input.email),
      source: input.source,
      subscribedAt: new Date().toISOString(),
      ip: input.ip || null,
      userAgent: input.userAgent || null,
      referrer: input.referrer || null,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Newsletter webhook failed (${response.status}): ${bodyText.slice(0, 240)}`);
  }

  return {
    provider: 'webhook',
    providerSubscriberId: null,
    providerListId: null,
  };
}

async function ensureNewsletterTable(): Promise<void> {
  if (ensureTablePromise) return ensureTablePromise;

  ensureTablePromise = (async () => {
    const pool = await getPoolAsync();
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS maleq_newsletter_subscribers (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          email VARCHAR(255) NOT NULL,
          source VARCHAR(64) NOT NULL DEFAULT 'unknown',
          status ENUM('active', 'unsubscribed') NOT NULL DEFAULT 'active',
          ip VARCHAR(64) NULL,
          user_agent VARCHAR(512) NULL,
          referrer VARCHAR(1024) NULL,
          provider VARCHAR(32) NULL,
          provider_subscriber_id VARCHAR(191) NULL,
          provider_list_id VARCHAR(191) NULL,
          sync_status ENUM('pending', 'synced', 'failed', 'skipped') NOT NULL DEFAULT 'skipped',
          sync_error TEXT NULL,
          subscribed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          last_subscribed_at TIMESTAMP NULL DEFAULT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_newsletter_email (email),
          KEY idx_newsletter_status (status),
          KEY idx_newsletter_sync_status (sync_status)
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

      await pool.query('SELECT 1 FROM maleq_newsletter_subscribers LIMIT 1');
    }
  })();

  try {
    await ensureTablePromise;
  } catch (error) {
    ensureTablePromise = null;
    throw error;
  }
}

async function upsertSubscriber(
  input: NewsletterSubscribeInput,
  initialSyncStatus: SyncStatus
): Promise<boolean> {
  const pool = await getPoolAsync();
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO maleq_newsletter_subscribers
      (email, source, status, ip, user_agent, referrer, sync_status, sync_error, last_subscribed_at)
     VALUES (?, ?, 'active', ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
      source = VALUES(source),
      status = 'active',
      ip = VALUES(ip),
      user_agent = VALUES(user_agent),
      referrer = VALUES(referrer),
      sync_status = VALUES(sync_status),
      sync_error = NULL,
      last_subscribed_at = CURRENT_TIMESTAMP`,
    [
      normalizeEmail(input.email),
      truncate(input.source, 64) || 'unknown',
      truncate(input.ip, 64),
      truncate(input.userAgent, 512),
      truncate(input.referrer, 1024),
      initialSyncStatus,
    ]
  );

  return result.affectedRows === 1;
}

async function updateSyncState(
  email: string,
  state: {
    syncStatus: SyncStatus;
    provider: ProviderName | null;
    providerSubscriberId: string | null;
    providerListId: string | null;
    syncError: string | null;
  }
): Promise<void> {
  const pool = await getPoolAsync();
  await pool.execute(
    `UPDATE maleq_newsletter_subscribers
     SET provider = ?,
         provider_subscriber_id = ?,
         provider_list_id = ?,
         sync_status = ?,
         sync_error = ?
     WHERE email = ?`,
    [
      state.provider,
      truncate(state.providerSubscriberId, 191),
      truncate(state.providerListId, 191),
      state.syncStatus,
      state.syncError,
      normalizeEmail(email),
    ]
  );
}

async function syncWithProvider(
  config: ProviderConfig,
  input: NewsletterSubscribeInput
): Promise<ProviderSyncResult> {
  if (config.provider === 'mailchimp') {
    return syncToMailchimp(config, input);
  }

  return syncToWebhook(config, input);
}

export function getEmailFingerprint(email: string): string {
  return crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

export async function subscribeNewsletter(
  input: NewsletterSubscribeInput
): Promise<NewsletterSubscribeResult> {
  await ensureNewsletterTable();

  const providerConfig = resolveProviderConfig();
  const initialSyncStatus: SyncStatus = providerConfig ? 'pending' : 'skipped';
  const created = await upsertSubscriber(input, initialSyncStatus);

  if (!providerConfig) {
    await updateSyncState(input.email, {
      syncStatus: 'skipped',
      provider: null,
      providerSubscriberId: null,
      providerListId: null,
      syncError: null,
    });

    return {
      created,
      syncStatus: 'skipped',
      provider: null,
      providerSubscriberId: null,
      providerListId: null,
      syncError: null,
    };
  }

  try {
    const syncResult = await syncWithProvider(providerConfig, input);
    await updateSyncState(input.email, {
      syncStatus: 'synced',
      provider: syncResult.provider,
      providerSubscriberId: syncResult.providerSubscriberId,
      providerListId: syncResult.providerListId,
      syncError: null,
    });

    return {
      created,
      syncStatus: 'synced',
      provider: syncResult.provider,
      providerSubscriberId: syncResult.providerSubscriberId,
      providerListId: syncResult.providerListId,
      syncError: null,
    };
  } catch (error) {
    const syncError = error instanceof Error ? error.message : String(error);
    await updateSyncState(input.email, {
      syncStatus: 'failed',
      provider: providerConfig.provider,
      providerSubscriberId: null,
      providerListId:
        providerConfig.provider === 'mailchimp' ? providerConfig.audienceId : null,
      syncError,
    });

    return {
      created,
      syncStatus: 'failed',
      provider: providerConfig.provider,
      providerSubscriberId: null,
      providerListId:
        providerConfig.provider === 'mailchimp' ? providerConfig.audienceId : null,
      syncError,
    };
  }
}

export async function getSubscriberSyncStateByEmail(email: string): Promise<{
  syncStatus: SyncStatus;
  provider: string | null;
  syncError: string | null;
} | null> {
  await ensureNewsletterTable();
  const pool = await getPoolAsync();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT sync_status, provider, sync_error
     FROM maleq_newsletter_subscribers
     WHERE email = ?
     LIMIT 1`,
    [normalizeEmail(email)]
  );

  const row = rows[0] as
    | { sync_status: SyncStatus; provider: string | null; sync_error: string | null }
    | undefined;

  if (!row) return null;

  return {
    syncStatus: row.sync_status,
    provider: row.provider,
    syncError: row.sync_error,
  };
}
