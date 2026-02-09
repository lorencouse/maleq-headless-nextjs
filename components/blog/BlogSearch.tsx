'use client';

import { Suspense } from 'react';
import SearchAutocomplete from '@/components/search/SearchAutocomplete';

function BlogSearchInner() {
  return (
    <SearchAutocomplete
      defaultMode='articles'
      className='max-w-md'
      persistFromUrl={true}
    />
  );
}

export default function BlogSearch() {
  return (
    <Suspense fallback={
      <div className="max-w-md w-full h-[42px] bg-muted rounded-lg animate-pulse" />
    }>
      <BlogSearchInner />
    </Suspense>
  );
}
