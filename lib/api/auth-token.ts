/**
 * Auth Token Utilities
 *
 * Handles composite token format: base64(userId:rawToken)
 * The composite token embeds the user ID alongside the raw WordPress token,
 * allowing the frontend to extract both for server-side validation.
 *
 * The composite token is carried in an httpOnly `maleq_session` cookie (set by
 * the auth routes), NOT in localStorage — so an XSS can't read it. For
 * backward compatibility during/after migration, `extractAuthToken` also still
 * accepts an `Authorization: Bearer <token>` header.
 */
import type { NextResponse } from 'next/server';

export interface DecodedToken {
  userId: number;
  rawToken: string;
}

/** Name of the httpOnly session cookie carrying the composite auth token. */
export const SESSION_COOKIE_NAME = 'maleq_session';

/** Session lifetime in seconds — must match the WordPress token TTL (24h). */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

/**
 * Encode a composite auth token from userId + raw WP token.
 */
export function encodeAuthToken(userId: number, rawToken: string): string {
  return Buffer.from(`${userId}:${rawToken}`).toString('base64');
}

/**
 * Decode a composite auth token into userId + rawToken.
 * Returns null if the token is invalid.
 */
export function decodeAuthToken(compositeToken: string): DecodedToken | null {
  try {
    const decoded = Buffer.from(compositeToken, 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) return null;

    const userId = parseInt(decoded.substring(0, colonIndex), 10);
    const rawToken = decoded.substring(colonIndex + 1);

    if (isNaN(userId) || userId <= 0 || !rawToken) return null;

    return { userId, rawToken };
  } catch {
    return null;
  }
}

/**
 * Read the raw composite token from the session cookie, if present.
 * Parses the `Cookie` header directly so it works with both `Request` and
 * `NextRequest` without coupling to the framework type.
 */
function readSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Extract and decode the composite auth token from a request.
 *
 * Prefers the httpOnly `maleq_session` cookie (the secure path); falls back to
 * an `Authorization: Bearer <token>` header for backward compatibility. Returns
 * null if no valid token is found in either place.
 */
export function extractAuthToken(request: Request): DecodedToken | null {
  const cookieToken = readSessionCookie(request);
  if (cookieToken) {
    const decoded = decodeAuthToken(cookieToken);
    if (decoded) return decoded;
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const compositeToken = authHeader.substring(7);
  return decodeAuthToken(compositeToken);
}

/**
 * Set the httpOnly session cookie on a response. Call this from the auth
 * routes (login/register/google) with the composite token.
 */
export function setSessionCookie(response: NextResponse, compositeToken: string): void {
  response.cookies.set(SESSION_COOKIE_NAME, compositeToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Clear the session cookie on a response (logout). */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
