import { GraphQLClient, type RequestDocument } from 'graphql-request';

const endpoint = process.env.NEXT_PUBLIC_WORDPRESS_API_URL!;

/**
 * Revalidation tiers for different query types.
 * Static data (categories, brands) changes rarely — cache longer.
 * Product listings change more often (stock, price) — shorter cache.
 * Search is the most dynamic — shortest cache.
 */
export const REVALIDATE = {
  /** Categories, brands, materials, colors — rarely change */
  STATIC: 3600,
  /** Product listings, filtered results */
  PRODUCTS: 300,
  /** Search queries, dynamic content */
  DYNAMIC: 60,
} as const;

// Default client uses PRODUCTS tier (5 min)
const graphqlClient = new GraphQLClient(endpoint, {
  fetch: (input: URL | RequestInfo, init?: RequestInit) =>
    fetch(input, { ...init, next: { revalidate: REVALIDATE.PRODUCTS } } as RequestInit),
});

/** Create a client with a specific revalidation time */
function createClientWithRevalidate(revalidate: number) {
  return new GraphQLClient(endpoint, {
    fetch: (input: URL | RequestInfo, init?: RequestInit) =>
      fetch(input, { ...init, next: { revalidate } } as RequestInit),
  });
}

interface QueryOptions {
  query: RequestDocument;
  variables?: Record<string, unknown>;
  /** Override the default revalidation time for this query */
  revalidate?: number;
}

interface MutateOptions {
  mutation: RequestDocument;
  variables?: Record<string, unknown>;
}

/**
 * Compatibility wrapper that matches the previous Apollo Client API shape.
 * Consumer code can continue using:
 *   getClient().query({ query, variables })
 *   getClient().mutate({ mutation, variables })
 *
 * Now supports per-query revalidation:
 *   getClient().query({ query, variables, revalidate: REVALIDATE.STATIC })
 */
function createCompatClient() {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: async <T = any>({ query, variables, revalidate }: QueryOptions): Promise<{ data: T }> => {
      const client = revalidate !== undefined
        ? createClientWithRevalidate(revalidate)
        : graphqlClient;
      try {
        const data = await client.request<T>(query, variables);
        return { data };
      } catch (error: unknown) {
        // graphql-request throws when the response contains errors even if data
        // is present (e.g. WPGraphQL returns data.product: null alongside
        // "No product ID was found" error). Return the data and let callers
        // handle nulls instead of treating it as a failure.
        if (
          error &&
          typeof error === 'object' &&
          'response' in error
        ) {
          const resp = (error as { response: { data?: T } }).response;
          if (resp?.data !== undefined) {
            return { data: resp.data };
          }
        }
        throw error;
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutate: async <T = any>({ mutation, variables }: MutateOptions): Promise<{ data: T }> => {
      const data = await graphqlClient.request<T>(mutation, variables);
      return { data };
    },
  };
}

// Server Components client - drop-in replacement for Apollo's getClient()
export function getClient() {
  return createCompatClient();
}
