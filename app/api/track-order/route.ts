import { trackOrderSchema } from '@/lib/validations/tracking';
import {
  successResponse,
  validationError,
  errorResponse,
  handleApiError,
} from '@/lib/api/response';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const result = trackOrderSchema.safeParse(body);
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const field = issue.path.join('.');
        errors[field] = issue.message;
      });
      return validationError(errors);
    }

    const { orderNumber, email } = result.data;

    const wpUrl = process.env.NEXT_PUBLIC_WORDPRESS_URL || process.env.WORDPRESS_URL;
    if (!wpUrl) {
      return errorResponse('Service configuration error', 500);
    }

    const response = await fetch(`${wpUrl}/wp-json/maleq/v1/track-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_number: orderNumber,
        email,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.message || 'No order found. Please check your details.';
      return errorResponse(message, response.status);
    }

    return successResponse(data.order);
  } catch (error) {
    return handleApiError(error, 'Failed to look up order');
  }
}
