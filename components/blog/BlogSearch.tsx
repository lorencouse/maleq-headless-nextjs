'use client';

import SearchAutocomplete from '@/components/search/SearchAutocomplete';

export default function BlogSearch() {
  return (
    <SearchAutocomplete
      defaultMode='articles'
      className='max-w-md'
    />
  );
}
