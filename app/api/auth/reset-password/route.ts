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

const resetPasswordRequestSchema = z.object({
  email: z.string().optional(),
  key: z.string().optional(),
  password: z.string().optional(),
  honeypot: z.string().optional(),
  formStartTime: z.union([z.string(), z.number()]).optional(),
  captchaToken: z.string().optional(),
});

export async function POST(request: NextRequest) {
  let normalizedIdentifier = '';
  let guardMeta: AuthRequestMeta | undefined;

  try {
    const body = await request.json();
    const parsedBody = resetPasswordRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Email, reset key, and new password are required' },
        { status: 400 }
      );
    }

    const { email, key, password, honeypot, formStartTime, captchaToken } = parsedBody.data;
    const safeEmail = (email || '').trim();
    const safeKey = (key || '').trim();
    const safePassword = password || '';

    const guardResult = await runAuthGuard({
      request,
      route: 'reset_password',
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

    // Validate required fields
    if (!safeEmail || !safeKey || !safePassword) {
      await recordAuthFailure(
        'reset_password',
        guardResult.meta,
        normalizedIdentifier,
        'missing_required_fields'
      );
      return NextResponse.json(
        { error: 'Email, reset key, and new password are required' },
        { status: 400 }
      );
    }

    // Validate password strength
    if (safePassword.length < 12) {
      await recordAuthFailure(
        'reset_password',
        guardResult.meta,
        normalizedIdentifier,
        'weak_password'
      );
      return NextResponse.json(
        { error: 'Password must be at least 12 characters' },
        { status: 400 }
      );
    }

    // Use our custom WordPress endpoint for password reset
    const resetUrl = `${WOOCOMMERCE_URL}/wp-json/maleq/v1/reset-password`;

    const response = await fetch(resetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: safeEmail, key: safeKey, password: safePassword }),
    });

    const data = (await response.json().catch(() => ({}))) as { message?: string };

    if (!response.ok) {
      await recordAuthFailure(
        'reset_password',
        guardResult.meta,
        normalizedIdentifier,
        `upstream_status_${response.status}`
      );
      return NextResponse.json(
        { error: data.message || 'Failed to reset password' },
        { status: response.status }
      );
    }

    clearAuthFailureState('reset_password', guardResult.meta, normalizedIdentifier);

    return NextResponse.json({
      success: true,
      message: data.message || 'Password has been reset successfully.',
    });
  } catch (error) {
    if (guardMeta) {
      await recordAuthFailure(
        'reset_password',
        guardMeta,
        normalizedIdentifier,
        'reset_password_exception'
      );
    }

    console.error('Reset password error:', error);

    return NextResponse.json(
      { error: 'Failed to reset password. Please try again.' },
      { status: 500 }
    );
  }
}
