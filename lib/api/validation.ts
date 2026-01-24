/**
 * API Validation Utilities
 * Shared validation functions for API routes
 */

/**
 * Email validation regex
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/**
 * Validate required fields
 * Returns an object with field names as keys and error messages as values
 */
export function validateRequired(
  data: Record<string, unknown>,
  requiredFields: string[]
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of requiredFields) {
    const value = data[field];
    if (value === undefined || value === null || value === '') {
      errors[field] = `${formatFieldName(field)} is required`;
    }
  }

  return errors;
}

/**
 * Validate email field
 */
export function validateEmail(
  email: string | undefined | null
): string | null {
  if (!email) {
    return 'Email is required';
  }
  if (!isValidEmail(email)) {
    return 'Invalid email format';
  }
  return null;
}

/**
 * Validate string length
 */
export function validateLength(
  value: string | undefined | null,
  fieldName: string,
  min?: number,
  max?: number
): string | null {
  if (!value) return null;

  if (min !== undefined && value.length < min) {
    return `${formatFieldName(fieldName)} must be at least ${min} characters`;
  }
  if (max !== undefined && value.length > max) {
    return `${formatFieldName(fieldName)} must be no more than ${max} characters`;
  }
  return null;
}

/**
 * Validate numeric range
 */
export function validateNumericRange(
  value: number | undefined | null,
  fieldName: string,
  min?: number,
  max?: number
): string | null {
  if (value === undefined || value === null) return null;

  if (min !== undefined && value < min) {
    return `${formatFieldName(fieldName)} must be at least ${min}`;
  }
  if (max !== undefined && value > max) {
    return `${formatFieldName(fieldName)} must be no more than ${max}`;
  }
  return null;
}

/**
 * Extract pagination parameters from URL search params
 */
export function extractPaginationParams(
  searchParams: URLSearchParams,
  defaults: { page?: number; perPage?: number; limit?: number } = {}
): {
  page: number;
  perPage: number;
  offset: number;
  after?: string;
  before?: string;
} {
  const page = Math.max(1, parseInt(searchParams.get('page') || String(defaults.page || 1), 10));
  const perPage = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get('per_page') || searchParams.get('limit') || String(defaults.perPage || defaults.limit || 24), 10))
  );
  const offset = (page - 1) * perPage;
  const after = searchParams.get('after') || undefined;
  const before = searchParams.get('before') || undefined;

  return { page, perPage, offset, after, before };
}

/**
 * Parse and validate integer from string
 */
export function parseIntSafe(
  value: string | null | undefined,
  defaultValue: number,
  min?: number,
  max?: number
): number {
  if (!value) return defaultValue;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaultValue;

  let result = parsed;
  if (min !== undefined) result = Math.max(min, result);
  if (max !== undefined) result = Math.min(max, result);

  return result;
}

/**
 * Parse and validate float from string
 */
export function parseFloatSafe(
  value: string | null | undefined,
  defaultValue: number,
  min?: number,
  max?: number
): number {
  if (!value) return defaultValue;

  const parsed = parseFloat(value);
  if (isNaN(parsed)) return defaultValue;

  let result = parsed;
  if (min !== undefined) result = Math.max(min, result);
  if (max !== undefined) result = Math.min(max, result);

  return result;
}

/**
 * Validate and sanitize a URL
 */
export function validateUrl(url: string | undefined | null): string | null {
  if (!url) return null;

  try {
    new URL(url);
    return null;
  } catch {
    return 'Invalid URL format';
  }
}

/**
 * Validate phone number (basic validation)
 */
export function validatePhone(phone: string | undefined | null): string | null {
  if (!phone) return null;

  // Remove common formatting characters
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');

  // Check if it's a valid phone number (basic check for digits and optional + prefix)
  if (!/^\+?[0-9]{7,15}$/.test(cleaned)) {
    return 'Invalid phone number format';
  }

  return null;
}

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(
  request: Request
): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Sanitize string for safe output
 */
export function sanitizeString(value: string): string {
  return value
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format field name for error messages (camelCase to Title Case)
 */
function formatFieldName(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

/**
 * Combine multiple validation results
 */
export function combineValidationErrors(
  ...errorObjects: (Record<string, string> | null | undefined)[]
): Record<string, string> {
  const combined: Record<string, string> = {};

  for (const errors of errorObjects) {
    if (errors) {
      Object.assign(combined, errors);
    }
  }

  return combined;
}

/**
 * Check if there are any validation errors
 */
export function hasErrors(errors: Record<string, string>): boolean {
  return Object.keys(errors).length > 0;
}
