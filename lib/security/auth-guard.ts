import { checkRateLimit } from '@/lib/api/rate-limit';
import { logDurableEvent } from '@/lib/monitoring/durable-events';

export type AuthRoute =
  | 'login'
  | 'register'
  | 'forgot_password'
  | 'reset_password';

export interface AuthRequestMeta {
  requestPath: string;
  ip: string;
  userAgent: string | null;
  referrer: string | null;
}

export interface AuthGuardInput {
  request: Request;
  route: AuthRoute;
  identifier?: string;
  honeypot?: string;
  formStartTime?: number | string;
  captchaToken?: string;
}

export interface AuthGuardResult {
  ok: boolean;
  meta: AuthRequestMeta;
  normalizedIdentifier: string;
  status?: number;
  error?: string;
  code?: string;
  retryAfterSeconds?: number;
}

interface FailureEntry {
  count: number;
  resetAt: number;
}

const RESERVED_IDENTIFIERS = new Set<string>([
  'root',
  'admin',
  'administrator',
  'sysadmin',
  'superuser',
  'support',
  'webmaster',
  'postmaster',
  'admin@maleq.com',
  'admin@www.maleq.com',
  'admin@wp.maleq.com',
  'support@maleq.com',
  'webmaster@maleq.com',
  'postmaster@maleq.com',
]);

const RESERVED_LOCAL_PARTS = new Set<string>([
  'admin',
  'administrator',
  'root',
  'sysadmin',
  'superuser',
  'support',
  'webmaster',
  'postmaster',
]);

const TRUSTED_DOMAINS = new Set<string>([
  'maleq.com',
  'www.maleq.com',
  'wp.maleq.com',
]);

const RESERVED_USERNAME_PATTERN = /^(admin|administrator|root|sysadmin|superuser)([\W_0-9].*)?$/i;

const RATE_LIMIT_WINDOW_SECONDS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS || 600); // 10 minutes
const RATE_LIMIT_IP_LIMIT = Number(process.env.AUTH_RATE_LIMIT_IP_LIMIT || 30);
const RATE_LIMIT_IDENTIFIER_LIMIT = Number(process.env.AUTH_RATE_LIMIT_IDENTIFIER_LIMIT || 12);
const RATE_LIMIT_PAIR_LIMIT = Number(process.env.AUTH_RATE_LIMIT_PAIR_LIMIT || 8);

const AUTH_FAILURE_WINDOW_SECONDS = Number(process.env.AUTH_FAILURE_WINDOW_SECONDS || 900); // 15 minutes
const AUTH_LOCKOUT_THRESHOLD = Number(process.env.AUTH_LOCKOUT_THRESHOLD || 12);
const AUTH_LOCKOUT_SECONDS = Number(process.env.AUTH_LOCKOUT_SECONDS || 3600); // 1 hour
const RESERVED_IDENTIFIER_BAN_SECONDS = Number(
  process.env.AUTH_RESERVED_IDENTIFIER_BAN_SECONDS || 86400
); // 24 hours
const BOT_BAN_SECONDS = Number(process.env.AUTH_BOT_BAN_SECONDS || 86400); // 24 hours
const MIN_FORM_FILL_MS = Number(process.env.AUTH_MIN_FORM_FILL_MS || 1200);

const AUTH_CAPTCHA_MODE = (process.env.AUTH_CAPTCHA_MODE || 'adaptive').toLowerCase();
const AUTH_CAPTCHA_FAILURE_THRESHOLD = Number(process.env.AUTH_CAPTCHA_FAILURE_THRESHOLD || 3);
const AUTH_RECAPTCHA_MIN_SCORE = Number(process.env.AUTH_RECAPTCHA_MIN_SCORE || 0.5);
const AUTH_MAX_IDENTIFIER_LENGTH = Number(process.env.AUTH_MAX_IDENTIFIER_LENGTH || 254);

const ipBanUntil = new Map<string, number>();
const failureStore = new Map<string, FailureEntry>();

function now(): number {
  return Date.now();
}

function cleanupStores(): void {
  const timestamp = now();

  for (const [ip, bannedUntil] of ipBanUntil.entries()) {
    if (bannedUntil <= timestamp) ipBanUntil.delete(ip);
  }

  for (const [key, entry] of failureStore.entries()) {
    if (entry.resetAt <= timestamp) failureStore.delete(key);
  }
}

function getClientIp(request: Request): string {
  const cloudflareIp = request.headers.get('cf-connecting-ip');
  if (cloudflareIp) {
    return cloudflareIp.trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return 'unknown';
}

function toRoutePath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return 'unknown';
  }
}

function maskIdentifier(identifier: string): string {
  if (!identifier) return 'none';

  if (identifier.includes('@')) {
    const [local, domain] = identifier.split('@');
    const localMasked = local.length <= 2 ? `${local[0] || '*'}*` : `${local.slice(0, 2)}***`;
    return `${localMasked}@${domain || 'unknown'}`;
  }

  return identifier.length <= 2 ? `${identifier[0] || '*'}*` : `${identifier.slice(0, 2)}***`;
}

export function normalizeAuthIdentifier(value?: string | null): string {
  const normalized = (value || '').trim().toLowerCase();
  return normalized.slice(0, AUTH_MAX_IDENTIFIER_LENGTH);
}

export function isReservedAuthIdentifier(value?: string | null): boolean {
  const normalized = normalizeAuthIdentifier(value);
  if (!normalized) return false;

  if (RESERVED_IDENTIFIERS.has(normalized)) {
    return true;
  }

  if (RESERVED_USERNAME_PATTERN.test(normalized)) {
    return true;
  }

  if (!normalized.includes('@')) {
    return false;
  }

  const [localPart, domain] = normalized.split('@');
  if (!localPart || !domain) {
    return false;
  }

  if (TRUSTED_DOMAINS.has(domain) && RESERVED_LOCAL_PARTS.has(localPart)) {
    return true;
  }

  return false;
}

function getFailureKey(route: AuthRoute, scope: 'ip' | 'identifier' | 'pair', value: string): string {
  return `auth-failure:${route}:${scope}:${value}`;
}

function bumpFailureKey(key: string): number {
  const timestamp = now();
  const windowMs = AUTH_FAILURE_WINDOW_SECONDS * 1000;
  const existing = failureStore.get(key);

  if (!existing || existing.resetAt <= timestamp) {
    failureStore.set(key, { count: 1, resetAt: timestamp + windowMs });
    return 1;
  }

  existing.count += 1;
  failureStore.set(key, existing);
  return existing.count;
}

function clearFailureKey(key: string): void {
  failureStore.delete(key);
}

function getFailureCount(key: string): number {
  const entry = failureStore.get(key);
  if (!entry) return 0;
  if (entry.resetAt <= now()) {
    failureStore.delete(key);
    return 0;
  }
  return entry.count;
}

function banIp(ip: string, seconds: number): void {
  ipBanUntil.set(ip, now() + seconds * 1000);
}

function getIpBanRemainingSeconds(ip: string): number {
  const bannedUntil = ipBanUntil.get(ip);
  if (!bannedUntil) return 0;
  return Math.max(0, Math.ceil((bannedUntil - now()) / 1000));
}

function shouldRequireCaptcha(route: AuthRoute, ip: string, identifier: string): boolean {
  if (!process.env.RECAPTCHA_SECRET_KEY) {
    return false;
  }

  if (AUTH_CAPTCHA_MODE === 'always') {
    return true;
  }
  if (AUTH_CAPTCHA_MODE === 'off') {
    return false;
  }

  // Adaptive mode: require captcha when failure counters are elevated.
  const ipFailures = getFailureCount(getFailureKey(route, 'ip', ip));
  const identifierFailures = identifier
    ? getFailureCount(getFailureKey(route, 'identifier', identifier))
    : 0;
  const pairFailures = identifier
    ? getFailureCount(getFailureKey(route, 'pair', `${ip}:${identifier}`))
    : 0;

  return (
    ipFailures >= AUTH_CAPTCHA_FAILURE_THRESHOLD ||
    identifierFailures >= AUTH_CAPTCHA_FAILURE_THRESHOLD ||
    pairFailures >= AUTH_CAPTCHA_FAILURE_THRESHOLD
  );
}

interface RecaptchaVerifyResponse {
  success?: boolean;
  score?: number;
  action?: string;
  ['error-codes']?: string[];
}

interface RecaptchaVerificationResult {
  valid: boolean;
  score?: number;
  action?: string;
  reason?: string;
}

async function verifyRecaptchaToken(
  token: string,
  ip: string,
  expectedAction: AuthRoute
): Promise<RecaptchaVerificationResult> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return { valid: true };

  try {
    const body = new URLSearchParams({
      secret,
      response: token,
    });

    if (ip && ip !== 'unknown') {
      body.set('remoteip', ip);
    }

    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      cache: 'no-store',
    });

    if (!response.ok) {
      return { valid: false, reason: 'verification_http_error' };
    }

    const json = (await response.json()) as RecaptchaVerifyResponse;
    if (!json.success) {
      return {
        valid: false,
        reason: json['error-codes']?.join(',') || 'verification_failed',
      };
    }

    if (json.action && json.action !== expectedAction) {
      return {
        valid: false,
        score: json.score,
        action: json.action,
        reason: 'action_mismatch',
      };
    }

    if (typeof json.score === 'number' && json.score < AUTH_RECAPTCHA_MIN_SCORE) {
      return {
        valid: false,
        score: json.score,
        action: json.action,
        reason: 'score_below_threshold',
      };
    }

    return {
      valid: true,
      score: json.score,
      action: json.action,
    };
  } catch {
    return { valid: false, reason: 'verification_exception' };
  }
}

function guardFailure(
  meta: AuthRequestMeta,
  identifier: string,
  status: number,
  error: string,
  code: string,
  retryAfterSeconds?: number
): AuthGuardResult {
  return {
    ok: false,
    meta,
    normalizedIdentifier: identifier,
    status,
    error,
    code,
    retryAfterSeconds,
  };
}

export async function runAuthGuard(input: AuthGuardInput): Promise<AuthGuardResult> {
  cleanupStores();

  const meta: AuthRequestMeta = {
    requestPath: toRoutePath(input.request),
    ip: getClientIp(input.request),
    userAgent: input.request.headers.get('user-agent'),
    referrer: input.request.headers.get('referer'),
  };

  const normalizedIdentifier = normalizeAuthIdentifier(input.identifier);

  const banSeconds = getIpBanRemainingSeconds(meta.ip);
  if (banSeconds > 0) {
    await logDurableEvent({
      eventType: 'auth_guard_ip_banned',
      severity: 'warning',
      message: `Blocked ${input.route} attempt from banned IP`,
      requestPath: meta.requestPath,
      ip: meta.ip,
      userAgent: meta.userAgent,
      referrer: meta.referrer,
      payload: {
        route: input.route,
        retryAfterSeconds: banSeconds,
        identifierHint: maskIdentifier(normalizedIdentifier),
      },
    });

    return guardFailure(
      meta,
      normalizedIdentifier,
      429,
      'Too many attempts. Please try again later.',
      'AUTH_RATE_LIMITED',
      banSeconds
    );
  }

  if (input.honeypot && input.honeypot.trim().length > 0) {
    banIp(meta.ip, BOT_BAN_SECONDS);
    await logDurableEvent({
      eventType: 'auth_guard_honeypot_hit',
      severity: 'warning',
      message: `Blocked ${input.route} attempt due to honeypot hit`,
      requestPath: meta.requestPath,
      ip: meta.ip,
      userAgent: meta.userAgent,
      referrer: meta.referrer,
      payload: {
        route: input.route,
        identifierHint: maskIdentifier(normalizedIdentifier),
      },
    });

    return guardFailure(meta, normalizedIdentifier, 403, 'Request blocked.', 'AUTH_BLOCKED');
  }

  if (input.formStartTime !== undefined && input.formStartTime !== null) {
    const startedAt = Number(input.formStartTime);
    if (Number.isFinite(startedAt) && startedAt > 0) {
      const elapsedMs = now() - startedAt;
      if (elapsedMs >= 0 && elapsedMs < MIN_FORM_FILL_MS) {
        banIp(meta.ip, BOT_BAN_SECONDS);
        await logDurableEvent({
          eventType: 'auth_guard_fast_submit',
          severity: 'warning',
          message: `Blocked ${input.route} attempt due to fast submit`,
          requestPath: meta.requestPath,
          ip: meta.ip,
          userAgent: meta.userAgent,
          referrer: meta.referrer,
          payload: {
            route: input.route,
            elapsedMs,
            identifierHint: maskIdentifier(normalizedIdentifier),
          },
        });

        return guardFailure(meta, normalizedIdentifier, 403, 'Request blocked.', 'AUTH_BLOCKED');
      }
    }
  }

  if (isReservedAuthIdentifier(normalizedIdentifier)) {
    banIp(meta.ip, RESERVED_IDENTIFIER_BAN_SECONDS);
    await logDurableEvent({
      eventType: 'auth_guard_reserved_identifier',
      severity: 'warning',
      message: `Blocked ${input.route} attempt with reserved identifier`,
      requestPath: meta.requestPath,
      ip: meta.ip,
      userAgent: meta.userAgent,
      referrer: meta.referrer,
      payload: {
        route: input.route,
        identifierHint: maskIdentifier(normalizedIdentifier),
      },
    });

    return guardFailure(meta, normalizedIdentifier, 403, 'Request blocked.', 'AUTH_BLOCKED');
  }

  const rateChecks = [
    {
      scope: 'ip',
      result: checkRateLimit(`auth:${input.route}:ip:${meta.ip}`, {
        limit: RATE_LIMIT_IP_LIMIT,
        windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      }),
    },
    {
      scope: 'identifier',
      result: checkRateLimit(`auth:${input.route}:identifier:${normalizedIdentifier || 'unknown'}`, {
        limit: RATE_LIMIT_IDENTIFIER_LIMIT,
        windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      }),
    },
    {
      scope: 'pair',
      result: checkRateLimit(`auth:${input.route}:pair:${meta.ip}:${normalizedIdentifier || 'unknown'}`, {
        limit: RATE_LIMIT_PAIR_LIMIT,
        windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      }),
    },
  ];

  const violated = rateChecks.filter((entry) => !entry.result.allowed);
  if (violated.length > 0) {
    const retryAfterSeconds = Math.max(
      ...violated.map((entry) =>
        Math.max(1, Math.ceil((entry.result.resetTime - now()) / 1000))
      )
    );

    await logDurableEvent({
      eventType: 'auth_guard_rate_limited',
      severity: 'warning',
      message: `Rate limited ${input.route} attempt`,
      requestPath: meta.requestPath,
      ip: meta.ip,
      userAgent: meta.userAgent,
      referrer: meta.referrer,
      payload: {
        route: input.route,
        identifierHint: maskIdentifier(normalizedIdentifier),
        retryAfterSeconds,
        violatedScopes: violated.map((entry) => entry.scope),
      },
    });

    return guardFailure(
      meta,
      normalizedIdentifier,
      429,
      'Too many attempts. Please try again later.',
      'AUTH_RATE_LIMITED',
      retryAfterSeconds
    );
  }

  const captchaRequired = shouldRequireCaptcha(
    input.route,
    meta.ip,
    normalizedIdentifier
  );

  if (captchaRequired) {
    if (!input.captchaToken) {
      await logDurableEvent({
        eventType: 'auth_guard_captcha_required',
        severity: 'warning',
        message: `Captcha required for ${input.route} attempt`,
        requestPath: meta.requestPath,
        ip: meta.ip,
        userAgent: meta.userAgent,
        referrer: meta.referrer,
        payload: {
          route: input.route,
          identifierHint: maskIdentifier(normalizedIdentifier),
        },
      });

      return guardFailure(
        meta,
        normalizedIdentifier,
        400,
        'Please complete the security check and try again.',
        'CAPTCHA_REQUIRED'
      );
    }

    const captchaVerification = await verifyRecaptchaToken(
      input.captchaToken,
      meta.ip,
      input.route
    );
    if (!captchaVerification.valid) {
      await logDurableEvent({
        eventType: 'auth_guard_captcha_failed',
        severity: 'warning',
        message: `reCAPTCHA verification failed for ${input.route}`,
        requestPath: meta.requestPath,
        ip: meta.ip,
        userAgent: meta.userAgent,
        referrer: meta.referrer,
        payload: {
          route: input.route,
          reason: captchaVerification.reason,
          score: captchaVerification.score,
          action: captchaVerification.action,
          identifierHint: maskIdentifier(normalizedIdentifier),
        },
      });
      return guardFailure(
        meta,
        normalizedIdentifier,
        400,
        'Security check failed. Please try again.',
        'CAPTCHA_INVALID'
      );
    }
  }

  return {
    ok: true,
    meta,
    normalizedIdentifier,
  };
}

export async function recordAuthFailure(
  route: AuthRoute,
  meta: AuthRequestMeta,
  identifier: string,
  reason: string
): Promise<void> {
  cleanupStores();

  const ipKey = getFailureKey(route, 'ip', meta.ip);
  const ipCount = bumpFailureKey(ipKey);

  let identifierCount = 0;
  let pairCount = 0;
  if (identifier) {
    const identifierKey = getFailureKey(route, 'identifier', identifier);
    identifierCount = bumpFailureKey(identifierKey);

    const pairKey = getFailureKey(route, 'pair', `${meta.ip}:${identifier}`);
    pairCount = bumpFailureKey(pairKey);
  }

  if (ipCount >= AUTH_LOCKOUT_THRESHOLD) {
    banIp(meta.ip, AUTH_LOCKOUT_SECONDS);
  }

  await logDurableEvent({
    eventType: 'auth_attempt_failed',
    severity: 'warning',
    message: `${route} attempt failed`,
    requestPath: meta.requestPath,
    ip: meta.ip,
    userAgent: meta.userAgent,
    referrer: meta.referrer,
    payload: {
      route,
      reason,
      identifierHint: maskIdentifier(identifier),
      ipFailureCount: ipCount,
      identifierFailureCount: identifierCount,
      pairFailureCount: pairCount,
      ipLockedOut: ipCount >= AUTH_LOCKOUT_THRESHOLD,
    },
  });
}

export function clearAuthFailureState(
  route: AuthRoute,
  meta: AuthRequestMeta,
  identifier: string
): void {
  cleanupStores();

  clearFailureKey(getFailureKey(route, 'ip', meta.ip));

  if (!identifier) return;

  clearFailureKey(getFailureKey(route, 'identifier', identifier));
  clearFailureKey(getFailureKey(route, 'pair', `${meta.ip}:${identifier}`));
}
