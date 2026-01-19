import { NextRequest, NextResponse } from 'next/server';
import { wooClient } from '@/lib/woocommerce/client';

// GET /api/reviews?productId=123&page=1&per_page=10
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const productId = searchParams.get('productId');
    const page = parseInt(searchParams.get('page') || '1');
    const perPage = parseInt(searchParams.get('per_page') || '10');

    if (!productId) {
      return NextResponse.json(
        { error: 'Product ID is required' },
        { status: 400 }
      );
    }

    const reviews = await wooClient.getProductReviews(parseInt(productId), {
      per_page: perPage,
      page,
    });

    return NextResponse.json({
      reviews,
      page,
      perPage,
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reviews' },
      { status: 500 }
    );
  }
}

// POST /api/reviews - Create a new review
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { productId, reviewer, reviewerEmail, review, rating } = body;

    // Validate required fields
    if (!productId || !reviewer || !reviewerEmail || !review || !rating) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate rating
    if (rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: 'Rating must be between 1 and 5' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(reviewerEmail)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    const newReview = await wooClient.createReview({
      product_id: parseInt(productId),
      reviewer,
      reviewer_email: reviewerEmail,
      review,
      rating: parseInt(rating),
    });

    return NextResponse.json({
      success: true,
      review: newReview,
    });
  } catch (error) {
    console.error('Error creating review:', error);
    return NextResponse.json(
      { error: 'Failed to create review' },
      { status: 500 }
    );
  }
}
