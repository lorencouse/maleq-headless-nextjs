'use client';

import { Suspense } from 'react';
import SearchAutocomplete from '@/components/search/SearchAutocomplete';

function ShopSearchInner() {
  return (
    <SearchAutocomplete
      defaultMode='products'
      className='max-w-md'
      persistFromUrl={true}
    />
  );
}

export default function ShopSearch() {
  return (
    <Suspense fallback={
      <div className="max-w-md w-full h-[42px] bg-muted rounded-lg animate-pulse" />
    }>
      <ShopSearchInner />
    </Suspense>
  );
}
