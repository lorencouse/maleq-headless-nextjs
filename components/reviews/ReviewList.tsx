'use client';

import { useState, useEffect } from 'react';
import ReviewCard, { Review } from './ReviewCard';

interface ReviewListProps {
  productId: number;
  initialReviews?: Review[];
}

type SortOption = 'recent' | 'rating-high' | 'rating-low';

export default function ReviewList({ productId, initialReviews = [] }: ReviewListProps) {
  const [reviews, setReviews] = useState<Review[]>(initialReviews);
  const [loading, setLoading] = useState(initialReviews.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [filterRating, setFilterRating] = useState<number | null>(null);

  const fetchReviews = async (pageNum: number, append: boolean = false) => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/reviews?productId=${productId}&page=${pageNum}&per_page=5`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch reviews');
      }

      const data = await response.json();

      // Transform WooCommerce review format to our Review interface
      const transformedReviews: Review[] = data.reviews.map((r: any) => ({
        id: r.id,
        reviewer: r.reviewer,
        review: r.review,
        rating: r.rating,
        dateCreated: r.date_created,
        verified: r.verified,
        avatarUrl: r.reviewer_avatar_urls?.['96'] || null,
      }));

      if (append) {
        setReviews((prev) => [...prev, ...transformedReviews]);
      } else {
        setReviews(transformedReviews);
      }

      setHasMore(transformedReviews.length === 5);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialReviews.length === 0) {
      fetchReviews(1);
    }
  }, [productId]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchReviews(nextPage, true);
  };

  // Sort reviews
  const sortedReviews = [...reviews].sort((a, b) => {
    switch (sortBy) {
      case 'rating-high':
        return b.rating - a.rating;
      case 'rating-low':
        return a.rating - b.rating;
      case 'recent':
      default:
        return new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime();
    }
  });

  // Filter reviews
  const filteredReviews = filterRating
    ? sortedReviews.filter((r) => r.rating === filterRating)
    : sortedReviews;

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500">{error}</p>
        <button
          onClick={() => fetchReviews(1)}
          className="mt-4 px-4 py-2 text-primary hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Controls */}
      {reviews.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          {/* Sort */}
          <div className="flex items-center gap-2">
            <label htmlFor="sort-reviews" className="text-sm text-muted-foreground">
              Sort by:
            </label>
            <select
              id="sort-reviews"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-3 py-1.5 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="recent">Most Recent</option>
              <option value="rating-high">Highest Rating</option>
              <option value="rating-low">Lowest Rating</option>
            </select>
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Filter:</span>
            <div className="flex gap-1">
              <button
                onClick={() => setFilterRating(null)}
                className={`px-3 py-1 text-sm rounded-full transition-colors ${
                  filterRating === null
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                All
              </button>
              {[5, 4, 3, 2, 1].map((rating) => (
                <button
                  key={rating}
                  onClick={() => setFilterRating(rating)}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    filterRating === rating
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {rating}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Reviews */}
      {loading && reviews.length === 0 ? (
        <div className="space-y-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-muted rounded-full" />
                <div className="flex-1 space-y-3">
                  <div className="h-4 bg-muted rounded w-32" />
                  <div className="h-4 bg-muted rounded w-24" />
                  <div className="h-16 bg-muted rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredReviews.length === 0 ? (
        <div className="text-center py-12">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {filterRating ? 'No reviews match your filter' : 'No reviews yet'}
          </h3>
          <p className="text-muted-foreground">
            {filterRating
              ? 'Try selecting a different rating filter'
              : 'Be the first to share your thoughts!'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredReviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}

      {/* Load More */}
      {hasMore && filteredReviews.length > 0 && !filterRating && (
        <div className="text-center mt-8">
          <button
            onClick={loadMore}
            disabled={loading}
            className="px-6 py-2 border border-input rounded-lg text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load More Reviews'}
          </button>
        </div>
      )}
    </div>
  );
}
