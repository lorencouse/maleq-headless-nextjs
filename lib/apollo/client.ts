import { GraphQLClient, type RequestDocument } from 'graphql-request';

const endpoint = process.env.NEXT_PUBLIC_WORDPRESS_API_URL!;

// GraphQL client with Next.js ISR caching (default 60s revalidation)
const graphqlClient = new GraphQLClient(endpoint, {
  fetch: (input: URL | RequestInfo, init?: RequestInit) =>
    fetch(input, { ...init, next: { revalidate: 60 } } as RequestInit),
});

interface QueryOptions {
  query: RequestDocument;
  variables?: Record<string, unknown>;
  fetchPolicy?: string;
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
 */
function createCompatClient() {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: async <T = any>({ query, variables }: QueryOptions): Promise<{ data: T }> => {
      const data = await graphqlClient.request<T>(query, variables);
      return { data };
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
