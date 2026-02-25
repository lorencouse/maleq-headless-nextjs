import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_VERSION = 1;
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

interface OwnershipPayload {
  v: number;
  e: string; // endpoint
  iat: number;
  exp: number;
}

interface OwnershipTokenEnvelope {
  payload: string;
  sig: string;
}

export interface EndpointOwnershipToken {
  token: string;
  expiresAt: number;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

function getTokenSecret(): string {
  const configured =
    process.env.PUSH_ENDPOINT_TOKEN_SECRET ||
    process.env.ADMIN_API_KEY ||
    process.env.VAPID_PRIVATE_KEY;

  if (configured) return configured;
  if (process.env.NODE_ENV !== 'production') return 'maleq-dev-push-endpoint-secret';
  throw new Error('Push endpoint token secret not configured');
}

function signPayload(payloadPart: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadPart).digest('base64url');
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function parseToken(token: string): OwnershipTokenEnvelope | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  return { payload, sig };
}

export function createEndpointOwnershipToken(
  endpoint: string,
  ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS
): EndpointOwnershipToken {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: OwnershipPayload = {
    v: TOKEN_VERSION,
    e: endpoint,
    iat: nowSeconds,
    exp: nowSeconds + Math.max(60, ttlSeconds),
  };

  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const sig = signPayload(payloadPart, getTokenSecret());

  return {
    token: `${payloadPart}.${sig}`,
    expiresAt: payload.exp * 1000,
  };
}

export function verifyEndpointOwnershipToken(token: string, endpoint: string): boolean {
  const parsed = parseToken(token);
  if (!parsed) return false;

  const expectedSig = signPayload(parsed.payload, getTokenSecret());
  if (!safeCompare(parsed.sig, expectedSig)) return false;

  let payload: OwnershipPayload;
  try {
    payload = JSON.parse(base64UrlDecode(parsed.payload)) as OwnershipPayload;
  } catch {
    return false;
  }

  if (payload.v !== TOKEN_VERSION) return false;
  if (payload.e !== endpoint) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) return false;

  return true;
}
