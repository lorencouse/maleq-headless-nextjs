import { GraphQLClient, type RequestDocument } from 'graphql-request';
import { getGraphqlUrl } from '@/lib/config/wp-env';

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
  /** Long-lived content (blog posts, CMS pages) on ISR routes whose own
   *  `export const revalidate` is monthly and that rely on a webhook
   *  (revalidatePath) for real-time invalidation. Match this to the route's
   *  revalidate: Next sets the route's revalidation to the LOWEST revalidate
   *  among its segment config AND its fetches, so a short fetch TTL here would
   *  drag the whole page down to that interval. 30 days. */
  MONTH: 2592000,
  /** Minimal Data Cache — use for by-slug lookups in ISR pages where the page
   *  cache already handles caching. Uses 1s TTL (not 0) to stay compatible
   *  with static generation; revalidate: 0 forces pages fully dynamic.
   *  CAUTION: on a static/ISR route this 1s TTL becomes the ROUTE's revalidate
   *  (lowest-wins), making the page revalidate every second — use REVALIDATE.MONTH
   *  for by-slug content fetches on monthly-ISR + webhook routes instead. */
  NONE: 1,
} as const;

/** Create a client with a specific revalidation time (resolved lazily) */
function createClientWithRevalidate(revalidate: number) {
  return new GraphQLClient(getGraphqlUrl(), {
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
      const client = createClientWithRevalidate(revalidate ?? REVALIDATE.PRODUCTS);
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
      const client = createClientWithRevalidate(REVALIDATE.PRODUCTS);
      const data = await client.request<T>(mutation, variables);
      return { data };
    },
  };
}

// Server Components client - drop-in replacement for Apollo's getClient()
export function getClient() {
  return createCompatClient();
}
