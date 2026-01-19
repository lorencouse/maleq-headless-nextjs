'use client';

import StarRating from './StarRating';

interface ReviewSummaryProps {
  averageRating: number;
  reviewCount: number;
  ratingBreakdown?: {
    5: number;
    4: number;
    3: number;
    2: number;
    1: number;
  };
  onWriteReview?: () => void;
}

export default function ReviewSummary({
  averageRating,
  reviewCount,
  ratingBreakdown,
  onWriteReview,
}: ReviewSummaryProps) {
  const totalReviews = ratingBreakdown
    ? Object.values(ratingBreakdown).reduce((a, b) => a + b, 0)
    : reviewCount;

  const getPercentage = (count: number) => {
    if (totalReviews === 0) return 0;
    return Math.round((count / totalReviews) * 100);
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex flex-col md:flex-row md:items-start gap-8">
        {/* Overall Rating */}
        <div className="text-center md:text-left">
          <div className="text-5xl font-bold text-foreground mb-2">
            {averageRating.toFixed(1)}
          </div>
          <StarRating rating={averageRating} size="lg" />
          <p className="text-muted-foreground mt-2">
            Based on {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}
          </p>
          {onWriteReview && (
            <button
              onClick={onWriteReview}
              className="mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-medium"
            >
              Write a Review
            </button>
          )}
        </div>

        {/* Rating Breakdown */}
        {ratingBreakdown && (
          <div className="flex-1 space-y-2">
            {[5, 4, 3, 2, 1].map((rating) => {
              const count = ratingBreakdown[rating as keyof typeof ratingBreakdown];
              const percentage = getPercentage(count);

              return (
                <div key={rating} className="flex items-center gap-3">
                  <span className="w-8 text-sm text-muted-foreground text-right">
                    {rating}
                  </span>
                  <StarRating rating={rating} size="sm" />
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-yellow-400 rounded-full transition-all duration-300"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="w-12 text-sm text-muted-foreground">
                    {percentage}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
