import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client';
import { registerApolloClient } from '@apollo/experimental-nextjs-app-support/rsc';

// Apollo Client for Server Components (RSC)
export const { getClient } = registerApolloClient(() => {
  return new ApolloClient({
    cache: new InMemoryCache(),
    link: new HttpLink({
      uri: process.env.NEXT_PUBLIC_WORDPRESS_API_URL,
      // Disable caching to always fetch fresh data
      fetchOptions: { cache: 'no-store' },
    }),
    defaultOptions: {
      query: {
        fetchPolicy: 'no-cache',
      },
    },
  });
});

// Apollo Client singleton for Client Components
let client: ApolloClient<any> | null = null;

export function getApolloClient() {
  if (!client || typeof window === 'undefined') {
    client = new ApolloClient({
      uri: process.env.NEXT_PUBLIC_WORDPRESS_API_URL,
      cache: new InMemoryCache(),
    });
  }
  return client;
}
