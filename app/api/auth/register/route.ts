import { NextRequest, NextResponse } from 'next/server';
import { createCustomer, getCustomerByEmail, authenticateCustomer } from '@/lib/woocommerce/customers';
import {
  errorResponse,
  handleApiError,
  UserFacingError,
  validationError,
} from '@/lib/api/response';
import {
  combineValidationErrors,
  hasErrors,
  validateEmail,
  validateLength,
  validateRequired,
} from '@/lib/api/validation';
import { encodeAuthToken, setSessionCookie } from '@/lib/api/auth-token';
import {
  clearAuthFailureState,
  recordAuthFailure,
  runAuthGuard,
} from '@/lib/security/auth-guard';
import { z } from 'zod';

const registerRequestSchema = z.object({
  email: z.string().optional(),
  password: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
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
    const parsedBody = registerRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return validationError({
        email: 'Email is required',
        password: 'Password is required',
        firstName: 'First name is required',
        lastName: 'Last name is required',
      });
    }

    const { email, password, firstName, lastName, honeypot, formStartTime, captchaToken } = parsedBody.data;
    const safeEmail = email || '';
    const safePassword = password || '';
    const safeFirstName = firstName || '';
    const safeLastName = lastName || '';

    const guardResult = await runAuthGuard({
      request,
      route: 'register',
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
    const requiredErrors = validateRequired(parsedBody.data as Record<string, unknown>, [
      'email',
      'password',
      'firstName',
      'lastName',
    ]);

    // Validate email format
    const emailError = validateEmail(safeEmail);
    if (emailError && !requiredErrors.email) {
      requiredErrors.email = emailError;
    }

    // Validate password strength
    const passwordError = validateLength(safePassword, 'password', 8);
    if (passwordError && !requiredErrors.password) {
      requiredErrors.password = passwordError;
    }

    const errors = combineValidationErrors(requiredErrors);
    if (hasErrors(errors)) {
      await recordAuthFailure('register', guardResult.meta, normalizedIdentifier, 'validation_failed');
      return validationError(errors);
    }

    // Check if customer already exists
    const existingCustomer = await getCustomerByEmail(safeEmail);
    if (existingCustomer) {
      await recordAuthFailure('register', guardResult.meta, normalizedIdentifier, 'account_exists');
      return errorResponse(
        'An account with this email already exists',
        409,
        'ACCOUNT_EXISTS'
      );
    }

    // Create customer in WooCommerce
    const customer = await createCustomer({
      email: safeEmail,
      password: safePassword,
      first_name: safeFirstName,
      last_name: safeLastName,
      username: safeEmail,
    });

    // Authenticate the new user to get a valid WP token
    // This stores the token hash in WP so subsequent API calls work
    const { token: rawToken } = await authenticateCustomer(safeEmail, safePassword);
    const compositeToken = encodeAuthToken(customer.id, rawToken);
    clearAuthFailureState('register', guardResult.meta, normalizedIdentifier);

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
    setSessionCookie(response, compositeToken);
    return response;
  } catch (error) {
    if (guardMeta) {
      await recordAuthFailure(
        'register',
        guardMeta,
        normalizedIdentifier,
        error instanceof UserFacingError && error.code ? error.code : 'register_exception'
      );
    }
    return handleApiError(error, 'Registration failed');
  }
}
