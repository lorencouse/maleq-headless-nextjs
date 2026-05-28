import { redirect } from 'next/navigation';

interface SearchPageProps {
  searchParams: Promise<{ q?: string; [key: string]: string | string[] | undefined }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;

  // Build the redirect URL with all search params
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      urlParams.set(key, value);
    }
  }

  const queryString = urlParams.toString();
  redirect(queryString ? `/shop?${queryString}` : '/shop');
}
