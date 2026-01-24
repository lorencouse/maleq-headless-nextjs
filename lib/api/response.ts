import { NextResponse } from 'next/server';

/**
 * Standard API Response Types
 */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, string>;
}

export interface ApiPaginatedResponse<T> extends ApiSuccessResponse<T[]> {
  pageInfo?: {
    hasNextPage: boolean;
    hasPreviousPage?: boolean;
    startCursor?: string;
    endCursor?: string;
  };
  total?: number;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Create a success response
 */
export function successResponse<T>(
  data?: T,
  message?: string,
  status = 200
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json(
    {
      success: true as const,
      ...(data !== undefined && { data }),
      ...(message && { message }),
    },
    { status }
  );
}

/**
 * Create an error response
 */
export function errorResponse(
  error: string,
  status = 400,
  code?: string,
  details?: Record<string, string>
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false as const,
      error,
      ...(code && { code }),
      ...(details && { details }),
    },
    { status }
  );
}

/**
 * Create a validation error response
 */
export function validationError(
  errors: Record<string, string>
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false as const,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: errors,
    },
    { status: 400 }
  );
}

/**
 * Create a not found error response
 */
export function notFoundError(resource = 'Resource'): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false as const,
      error: `${resource} not found`,
      code: 'NOT_FOUND',
    },
    { status: 404 }
  );
}

/**
 * Create an unauthorized error response
 */
export function unauthorizedError(
  message = 'Unauthorized'
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false as const,
      error: message,
      code: 'UNAUTHORIZED',
    },
    { status: 401 }
  );
}

/**
 * Create a forbidden error response
 */
export function forbiddenError(
  message = 'Forbidden'
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false as const,
      error: message,
      code: 'FORBIDDEN',
    },
    { status: 403 }
  );
}

/**
 * Create an internal server error response
 */
export function serverError(
  message = 'Internal server error'
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false as const,
      error: message,
      code: 'INTERNAL_ERROR',
    },
    { status: 500 }
  );
}

/**
 * Create a paginated response
 */
export function paginatedResponse<T>(
  data: T[],
  pageInfo?: {
    hasNextPage: boolean;
    hasPreviousPage?: boolean;
    startCursor?: string;
    endCursor?: string;
  },
  total?: number
): NextResponse<ApiPaginatedResponse<T>> {
  return NextResponse.json({
    success: true as const,
    data,
    ...(pageInfo && { pageInfo }),
    ...(total !== undefined && { total }),
  });
}

/**
 * Handle API errors safely
 */
export function handleApiError(
  error: unknown,
  defaultMessage = 'An error occurred'
): NextResponse<ApiErrorResponse> {
  console.error('API Error:', error);

  if (error instanceof Error) {
    // Don't expose internal error messages in production
    const message =
      process.env.NODE_ENV === 'development' ? error.message : defaultMessage;
    return serverError(message);
  }

  return serverError(defaultMessage);
}
