import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api/response';
import {
  AuthRequestMeta,
  clearAuthFailureState,
  recordAuthFailure,
  runAuthGuard,
} from '@/lib/security/auth-guard';
import { z } from 'zod';

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');
const GENERIC_FORGOT_PASSWORD_RESPONSE = {
  success: true,
  message: 'If an account with that email exists, we have sent password reset instructions.',
};

const forgotPasswordRequestSchema = z.object({
  email: z.string().optional(),
  honeypot: z.string().optional(),
  formStartTime: z.union([z.string(), z.number()]).optional(),
  captchaToken: z.string().optional(),
});

export async function POST(request: NextRequest) {
  let normalizedIdentifier = '';
  let guardMeta: AuthRequestMeta | undefined;

  try {
    const body = await request.json();
    const parsedBody = forgotPasswordRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(GENERIC_FORGOT_PASSWORD_RESPONSE);
    }

    const { email, honeypot, formStartTime, captchaToken } = parsedBody.data;
    const safeEmail = (email || '').trim();

    const guardResult = await runAuthGuard({
      request,
      route: 'forgot_password',
      identifier: safeEmail,
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

    if (!safeEmail) {
      await recordAuthFailure(
        'forgot_password',
        guardResult.meta,
        normalizedIdentifier,
        'missing_email'
      );
      return NextResponse.json(GENERIC_FORGOT_PASSWORD_RESPONSE);
    }

    // Use our custom WordPress endpoint for password reset
    const resetUrl = `${WOOCOMMERCE_URL}/wp-json/maleq/v1/forgot-password`;

    const response = await fetch(resetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: safeEmail }),
    });

    const data = (await response.json().catch(() => ({}))) as { message?: string };

    if (!response.ok) {
      await recordAuthFailure(
        'forgot_password',
        guardResult.meta,
        normalizedIdentifier,
        `upstream_status_${response.status}`
      );
    } else {
      clearAuthFailureState('forgot_password', guardResult.meta, normalizedIdentifier);
    }

    // Always return success to prevent email enumeration attacks
    // The WordPress endpoint handles the actual email sending
    return NextResponse.json({
      success: true,
      message: data.message || GENERIC_FORGOT_PASSWORD_RESPONSE.message,
    });
  } catch (error) {
    if (guardMeta) {
      await recordAuthFailure(
        'forgot_password',
        guardMeta,
        normalizedIdentifier,
        'forgot_password_exception'
      );
    }

    console.error('Forgot password error:', error);

    // Still return success to prevent email enumeration
    return NextResponse.json(GENERIC_FORGOT_PASSWORD_RESPONSE);
  }
}
