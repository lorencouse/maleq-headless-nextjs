import { NextRequest } from 'next/server';
import { saveStockAlert, deleteStockAlert } from '@/lib/push/push-service';
import { successResponse, validationError, handleApiError } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { endpoint, productId, productName, productSlug } = body;

    if (!endpoint) {
      return validationError({ endpoint: 'Push endpoint is required' });
    }
    if (!productId || !productName || !productSlug) {
      return validationError({
        product: 'productId, productName, and productSlug are required',
      });
    }

    await saveStockAlert(endpoint, {
      productId: Number(productId),
      productName,
      productSlug,
    });

    return successResponse(null, 'Stock alert created');
  } catch (error) {
    return handleApiError(error, 'Failed to create stock alert');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { endpoint, productId } = body;

    if (!endpoint || !productId) {
      return validationError({
        params: 'endpoint and productId are required',
      });
    }

    await deleteStockAlert(endpoint, Number(productId));
    return successResponse(null, 'Stock alert removed');
  } catch (error) {
    return handleApiError(error, 'Failed to remove stock alert');
  }
}
