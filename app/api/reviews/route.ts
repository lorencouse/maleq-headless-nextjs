import { NextRequest, NextResponse } from 'next/server';
import { wooClient } from '@/lib/woocommerce/client';
import {
  errorResponse,
  validationError,
  successResponse,
  handleApiError,
} from '@/lib/api/response';
import {
  validateRequired,
  validateEmail,
  validateNumericRange,
  parseIntSafe,
  hasErrors,
} from '@/lib/api/validation';
import { checkSpam } from '@/lib/api/spam-check';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';

function getReviewRateLimitKey(request: NextRequest): string {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  const userAgent = (request.headers.get('user-agent') || 'na').slice(0, 64);
  return `reviews:${ip}:${userAgent}`;
}

// GET /api/reviews?productId=123&page=1&per_page=10
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const productId = searchParams.get('productId');
    const page = parseIntSafe(searchParams.get('page'), 1, 1);
    const perPage = parseIntSafe(searchParams.get('per_page'), 10, 1, 100);

    if (!productId) {
      return errorResponse('Product ID is required', 400, 'MISSING_PRODUCT_ID');
    }

    const reviews = await wooClient.getProductReviews(parseInt(productId), {
      per_page: perPage,
      page,
    });

    return NextResponse.json({
      success: true,
      data: reviews,
      page,
      perPage,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch reviews');
  }
}

// POST /api/reviews - Create a new review
export async function POST(request: NextRequest) {
  try {
    const rateResult = checkRateLimit(getReviewRateLimitKey(request), RATE_LIMITS.form);
    if (!rateResult.allowed) {
      return errorResponse('Too many requests. Please try again later.', 429, 'RATE_LIMITED');
    }

    const body = await request.json();
    const { productId, reviewer, reviewerEmail, review, rating } = body;

    const spamResponse = checkSpam(body, 'Review submitted successfully');
    if (spamResponse) return spamResponse;

    // Validate required fields
    const errors = validateRequired(body, ['productId', 'reviewer', 'reviewerEmail', 'review', 'rating']);

    // Validate email format
    const emailError = validateEmail(reviewerEmail);
    if (emailError && !errors.reviewerEmail) {
      errors.reviewerEmail = emailError;
    }

    // Validate rating range
    const ratingError = validateNumericRange(rating, 'rating', 1, 5);
    if (ratingError && !errors.rating) {
      errors.rating = ratingError;
    }

    if (hasErrors(errors)) {
      return validationError(errors);
    }

    const newReview = await wooClient.createReview({
      product_id: parseInt(productId),
      reviewer,
      reviewer_email: reviewerEmail,
      review,
      rating: parseInt(rating),
    });

    return successResponse(newReview, 'Review submitted successfully', 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create review');
  }
}
