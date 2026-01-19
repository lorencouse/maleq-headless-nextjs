'use client';

import { useState, useEffect } from 'react';
import ReviewSummary from './ReviewSummary';
import ReviewList from './ReviewList';
import WriteReviewForm from './WriteReviewForm';

interface ProductReviewsProps {
  productId: number;
  productName: string;
  averageRating: number;
  reviewCount: number;
}

export default function ProductReviews({
  productId,
  productName,
  averageRating,
  reviewCount,
}: ProductReviewsProps) {
  const [showWriteReview, setShowWriteReview] = useState(false);
  const [key, setKey] = useState(0);

  const handleReviewSuccess = () => {
    setShowWriteReview(false);
    // Force refresh of review list
    setKey((prev) => prev + 1);
  };

  return (
    <div className="mt-16 border-t border-border pt-12">
      <h2 className="text-2xl font-bold text-foreground mb-8">Customer Reviews</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Summary - Left Side on Desktop */}
        <div className="lg:col-span-1">
          <ReviewSummary
            averageRating={averageRating || 0}
            reviewCount={reviewCount || 0}
            onWriteReview={() => setShowWriteReview(true)}
          />
        </div>

        {/* Reviews List - Right Side on Desktop */}
        <div className="lg:col-span-2">
          {showWriteReview ? (
            <WriteReviewForm
              productId={productId}
              productName={productName}
              onSuccess={handleReviewSuccess}
              onCancel={() => setShowWriteReview(false)}
            />
          ) : (
            <ReviewList key={key} productId={productId} />
          )}
        </div>
      </div>
    </div>
  );
}
