'use client';

import AccountLayout from '@/components/account/AccountLayout';
import NewsReviewQueue from '@/components/account/NewsReviewQueue';

export default function NewsReviewPage() {
  return (
    <AccountLayout>
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">News Review</h1>
        <NewsReviewQueue />
      </div>
    </AccountLayout>
  );
}
