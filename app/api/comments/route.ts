import { NextRequest } from 'next/server';
import { getClient } from '@/lib/apollo/client';
import { CREATE_COMMENT } from '@/lib/queries/posts';
import {
  successResponse,
  validationError,
  handleApiError,
  errorResponse,
} from '@/lib/api/response';
import {
  validateEmail,
  validateLength,
  hasErrors,
} from '@/lib/api/validation';
import { checkSpam } from '@/lib/api/spam-check';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';

interface CommentFormData {
  postId: number;
  author: string;
  email: string;
  content: string;
  parentId?: number;
}

function getCommentRateLimitKey(request: NextRequest): string {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  const userAgent = (request.headers.get('user-agent') || 'na').slice(0, 64);
  return `comments:${ip}:${userAgent}`;
}

export async function POST(request: NextRequest) {
  try {
    const rateResult = checkRateLimit(getCommentRateLimitKey(request), RATE_LIMITS.form);
    if (!rateResult.allowed) {
      return errorResponse('Too many requests. Please try again later.', 429, 'RATE_LIMITED');
    }

    const body = await request.json();
    const { postId, author, email, content, parentId } = body as CommentFormData & { website?: string; _t?: number };

    const spamResponse = checkSpam(body, 'Your comment has been submitted and is awaiting moderation.');
    if (spamResponse) return spamResponse;

    // Validate required fields
    const errors: Record<string, string> = {};

    if (!postId) {
      errors.postId = 'Post ID is required';
    }

    if (!author || !author.trim()) {
      errors.author = 'Name is required';
    }

    // Validate email format
    const emailError = validateEmail(email);
    if (emailError) {
      errors.email = emailError;
    }

    if (!content || !content.trim()) {
      errors.content = 'Comment is required';
    } else {
      const lengthError = validateLength(content, 'comment', 10);
      if (lengthError) {
        errors.content = lengthError;
      }
    }

    if (hasErrors(errors)) {
      return validationError(errors);
    }

    // Submit comment to WordPress via GraphQL
    const { data } = await getClient().mutate({
      mutation: CREATE_COMMENT,
      variables: {
        input: {
          commentOn: postId,
          author: author.trim(),
          authorEmail: email.trim(),
          content: content.trim(),
          parent: parentId || null,
        },
      },
    });

    if (!data?.createComment?.success) {
      return validationError({ general: 'Failed to submit comment. Please try again.' });
    }

    return successResponse(
      data.createComment.comment,
      'Your comment has been submitted and is awaiting moderation.'
    );
  } catch (error) {
    console.error('Comment submission error:', error);
    return handleApiError(error, 'Failed to submit comment. Please try again.');
  }
}
