'use client';

import StarRating from './StarRating';

export interface Review {
  id: number;
  reviewer: string;
  review: string;
  rating: number;
  dateCreated: string;
  verified?: boolean;
  avatarUrl?: string;
}

interface ReviewCardProps {
  review: Review;
}

export default function ReviewCard({ review }: ReviewCardProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Get initials for avatar fallback
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Strip HTML tags from review content
  const cleanReview = (html: string) => {
    return html.replace(/<[^>]*>/g, '');
  };

  return (
    <div className="border-b border-border pb-6 last:border-0 last:pb-0">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="flex-shrink-0">
          {review.avatarUrl ? (
            <img
              src={review.avatarUrl}
              alt={review.reviewer}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-sm font-semibold text-primary">
                {getInitials(review.reviewer)}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-medium text-foreground">{review.reviewer}</span>
            {review.verified && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium rounded-full">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Verified Purchase
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mb-3">
            <StarRating rating={review.rating} size="sm" />
            <span className="text-sm text-muted-foreground">
              {formatDate(review.dateCreated)}
            </span>
          </div>

          <p className="text-foreground leading-relaxed">
            {cleanReview(review.review)}
          </p>
        </div>
      </div>
    </div>
  );
}
