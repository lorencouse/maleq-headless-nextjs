'use client';

import SearchAutocomplete from '@/components/search/SearchAutocomplete';

export default function ShopSearch() {
  return (
    <SearchAutocomplete
      defaultMode='products'
      className='max-w-md'
    />
  );
}
