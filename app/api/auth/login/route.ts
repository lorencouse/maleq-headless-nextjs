import { NextRequest, NextResponse } from 'next/server';
import { authenticateCustomer } from '@/lib/woocommerce/customers';
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

const loginRequestSchema = z.object({
  login: z.string().optional(),
  email: z.string().optional(),
  password: z.string().optional(),
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
    const parsedBody = loginRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return errorResponse('Invalid email/username or password', 401, 'INVALID_CREDENTIALS');
    }

    const { login, email, password, honeypot, formStartTime, captchaToken } = parsedBody.data;

    // Support both 'login' and 'email' parameters for backwards compatibility
    const identifier = (login || email || '').trim();

    const guardResult = await runAuthGuard({
      request,
      route: 'login',
      identifier,
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

    if (!identifier || !password) {
      await recordAuthFailure(
        'login',
        guardResult.meta,
        normalizedIdentifier,
        'missing_credentials'
      );
      return errorResponse('Invalid email/username or password', 401, 'INVALID_CREDENTIALS');
    }

    // Authenticate with WooCommerce/WordPress
    const { customer, token: rawToken } = await authenticateCustomer(identifier, password);

    // Create composite token: base64(userId:rawToken)
    const compositeToken = encodeAuthToken(customer.id, rawToken);

    clearAuthFailureState('login', guardResult.meta, normalizedIdentifier);

    const response = NextResponse.json({
      success: true,
      user: {
        id: customer.id,
        email: customer.email,
        firstName: customer.first_name,
        lastName: customer.last_name,
        displayName: `${customer.first_name} ${customer.last_name}`,
        avatarUrl: customer.avatar_url,
      },
    });
    // Token goes in an httpOnly cookie (not the JSON body / localStorage), so
    // an XSS can't read it. The server reads it back from the cookie.
    setSessionCookie(response, compositeToken);
    return response;
  } catch (error) {
    if (guardMeta) {
      await recordAuthFailure(
        'login',
        guardMeta,
        normalizedIdentifier,
        error instanceof UserFacingError && error.code
          ? error.code
          : 'login_exception'
      );
    }

    if (error instanceof UserFacingError && error.code === 'INVALID_CREDENTIALS') {
      return errorResponse('Invalid email/username or password', 401, 'INVALID_CREDENTIALS');
    }

    return handleApiError(error, 'Login failed');
  }
}
