/**
 * Auth Token Utilities
 *
 * Handles composite token format: base64(userId:rawToken)
 * The composite token embeds the user ID alongside the raw WordPress token,
 * allowing the frontend to extract both for server-side validation.
 */

export interface DecodedToken {
  userId: number;
  rawToken: string;
}

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
 * Extract and decode the Bearer token from a request's Authorization header.
 * Returns null if no valid token is found.
 */
export function extractAuthToken(request: Request): DecodedToken | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const compositeToken = authHeader.substring(7);
  return decodeAuthToken(compositeToken);
}
