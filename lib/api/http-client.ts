/**
 * HTTP Client Base Class
 *
 * Provides a standardized interface for making HTTP requests
 * with consistent error handling and response parsing.
 */

export interface HttpClientConfig {
  baseUrl: string;
  headers?: HeadersInit;
  timeout?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: HeadersInit;
  body?: unknown;
  timeout?: number;
}

export interface HttpResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export class HttpClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public data?: unknown
  ) {
    super(message);
    this.name = 'HttpClientError';
  }
}

/**
 * Base HTTP client for making API requests
 */
export class HttpClient {
  private baseUrl: string;
  private defaultHeaders: HeadersInit;
  private defaultTimeout: number;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.defaultHeaders = config.headers || {};
    this.defaultTimeout = config.timeout || 30000;
  }

  /**
   * Build full URL from path
   */
  private buildUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${normalizedPath}`;
  }

  /**
   * Make an HTTP request
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const { method = 'GET', headers = {}, body, timeout = this.defaultTimeout } = options;

    const url = this.buildUrl(path);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...this.defaultHeaders,
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new HttpClientError(
          errorData.message || `HTTP ${response.status}`,
          response.status,
          errorData.code,
          errorData
        );
      }

      const data = await response.json() as T;

      return {
        data,
        status: response.status,
        headers: response.headers,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof HttpClientError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new HttpClientError('Request timeout', 408, 'TIMEOUT');
        }
        throw new HttpClientError(error.message, 0, 'NETWORK_ERROR');
      }

      throw new HttpClientError('Unknown error', 0, 'UNKNOWN');
    }
  }

  /**
   * GET request
   */
  async get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  /**
   * PUT request
   */
  async put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  /**
   * PATCH request
   */
  async patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  /**
   * DELETE request
   */
  async delete<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

/**
 * Create an HTTP client with Basic Auth
 */
export function createBasicAuthClient(
  baseUrl: string,
  username: string,
  password: string,
  additionalHeaders?: HeadersInit
): HttpClient {
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  return new HttpClient({
    baseUrl,
    headers: {
      Authorization: authHeader,
      ...additionalHeaders,
    },
  });
}

/**
 * Create an HTTP client with Bearer token auth
 */
export function createBearerAuthClient(
  baseUrl: string,
  token: string,
  additionalHeaders?: HeadersInit
): HttpClient {
  return new HttpClient({
    baseUrl,
    headers: {
      Authorization: `Bearer ${token}`,
      ...additionalHeaders,
    },
  });
}
