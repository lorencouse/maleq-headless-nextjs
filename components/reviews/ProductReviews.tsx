'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('reviews');
  // Show write review form by default if there are no reviews
  const [showWriteReview, setShowWriteReview] = useState(reviewCount === 0);
  const [key, setKey] = useState(0);

  const handleReviewSuccess = () => {
    setShowWriteReview(false);
    // Force refresh of review list
    setKey((prev) => prev + 1);
  };

  return (
    <div className='mt-16 border-t border-border pt-12'>
      <h2 className='text-2xl font-bold text-foreground mb-8'>
        {t('title')}
      </h2>

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8'>
        {/* Summary - Left Side on Desktop */}
        <div className='lg:col-span-1'>
          <ReviewSummary
            averageRating={averageRating || 0}
            reviewCount={reviewCount || 0}
            onWriteReview={showWriteReview ? undefined : () => setShowWriteReview(true)}
          />
        </div>

        {/* Reviews List - Right Side on Desktop */}
        <div className='lg:col-span-2'>
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
