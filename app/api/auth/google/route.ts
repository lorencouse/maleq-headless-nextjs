import { NextRequest, NextResponse } from 'next/server';
import { authenticateWithGoogle } from '@/lib/woocommerce/customers';
import { verifyGoogleIdToken } from '@/lib/auth/google';
import {
  errorResponse,
  handleApiError,
  UserFacingError,
} from '@/lib/api/response';
import { encodeAuthToken, setSessionCookie } from '@/lib/api/auth-token';
import {
  clearAuthFailureState,
  recordAuthFailure,
  runAuthGuard,
} from '@/lib/security/auth-guard';
import { z } from 'zod';

const googleRequestSchema = z.object({
  credential: z.string().optional(),
  honeypot: z.string().optional(),
  formStartTime: z.union([z.string(), z.number()]).optional(),
  captchaToken: z.string().optional(),
});

export async function POST(request: NextRequest) {
  let normalizedIdentifier = '';
  let guardMeta:
    | {
        requestPath: string;
        ip: string;
        userAgent: string | null;
        referrer: string | null;
      }
    | undefined;

  try {
    const body = await request.json();
    const parsedBody = googleRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return errorResponse('Google sign-in failed', 401, 'GOOGLE_INVALID_TOKEN');
    }

    const { credential, honeypot, formStartTime, captchaToken } = parsedBody.data;

    if (!credential) {
      return errorResponse('Missing Google credential', 400, 'GOOGLE_MISSING_CREDENTIAL');
    }

    // Verify the Google ID token first so we have a trusted email for the guard.
    const profile = await verifyGoogleIdToken(credential);

    const guardResult = await runAuthGuard({
      request,
      route: 'login',
      identifier: profile.email,
      honeypot,
      formStartTime,
      captchaToken,
    });

    normalizedIdentifier = guardResult.normalizedIdentifier;
    guardMeta = guardResult.meta;

    if (!guardResult.ok) {
      const response = errorResponse(
        guardResult.error || 'Request blocked.',
        guardResult.status || 403,
        guardResult.code || 'AUTH_BLOCKED'
      );
      if (guardResult.retryAfterSeconds) {
        response.headers.set('Retry-After', String(guardResult.retryAfterSeconds));
      }
      return response;
    }

    // Find-or-create the WooCommerce customer (auto-link by email) and mint a token.
    const { customer, token: rawToken } = await authenticateWithGoogle(profile);

    const compositeToken = encodeAuthToken(customer.id, rawToken);

    clearAuthFailureState('login', guardResult.meta, normalizedIdentifier);

    const response = NextResponse.json({
      success: true,
      user: {
        id: customer.id,
        email: customer.email,
        firstName: customer.first_name,
        lastName: customer.last_name,
        displayName: `${customer.first_name} ${customer.last_name}`.trim(),
        avatarUrl: customer.avatar_url,
      },
    });
    setSessionCookie(response, compositeToken);
    return response;
  } catch (error) {
    if (guardMeta) {
      await recordAuthFailure(
        'login',
        guardMeta,
        normalizedIdentifier,
        error instanceof UserFacingError && error.code ? error.code : 'google_exception'
      );
    }

    if (error instanceof UserFacingError) {
      return errorResponse(error.message, error.statusCode || 401, error.code);
    }

    return handleApiError(error, 'Google sign-in failed');
  }
}
