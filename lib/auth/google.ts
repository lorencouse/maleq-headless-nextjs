/**
 * Google ID Token Verification
 *
 * Verifies the signed ID token (JWT) returned by Google Identity Services on the
 * client, server-side, against our OAuth client ID. Returns a normalized profile
 * used to find-or-create the WooCommerce customer.
 */

import { OAuth2Client } from 'google-auth-library';

import { UserFacingError } from '@/lib/api/response';

export interface GoogleProfile {
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  googleId: string;
  avatarUrl: string;
}

// The client ID is public (also exposed to the browser as NEXT_PUBLIC_GOOGLE_CLIENT_ID).
const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

let client: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  if (!client) {
    client = new OAuth2Client(GOOGLE_CLIENT_ID);
  }
  return client;
}

/**
 * Verify a Google ID token and return the normalized profile.
 * Throws UserFacingError if the token is invalid or the email is unverified.
 */
export async function verifyGoogleIdToken(credential: string): Promise<GoogleProfile> {
  if (!GOOGLE_CLIENT_ID) {
    throw new UserFacingError('Google sign-in is not configured', 500, 'GOOGLE_UNCONFIGURED');
  }

  if (!credential) {
    throw new UserFacingError('Missing Google credential', 400, 'GOOGLE_MISSING_CREDENTIAL');
  }

  let payload;
  try {
    const ticket = await getClient().verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw new UserFacingError('Could not verify Google sign-in', 401, 'GOOGLE_INVALID_TOKEN');
  }

  if (!payload || !payload.email) {
    throw new UserFacingError('Could not verify Google sign-in', 401, 'GOOGLE_INVALID_TOKEN');
  }

  if (payload.email_verified !== true) {
    throw new UserFacingError('Your Google email is not verified', 401, 'GOOGLE_EMAIL_UNVERIFIED');
  }

  return {
    email: payload.email,
    emailVerified: true,
    firstName: payload.given_name || '',
    lastName: payload.family_name || '',
    googleId: payload.sub,
    avatarUrl: payload.picture || '',
  };
}
