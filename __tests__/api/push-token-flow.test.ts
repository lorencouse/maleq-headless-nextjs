import { POST as subscribePost, DELETE as subscribeDelete } from '@/app/api/push/subscribe/route';
import { POST as preferencesPost } from '@/app/api/push/preferences/route';
import { POST as stockAlertPost } from '@/app/api/push/stock-alert/route';
import {
  saveSubscription,
  deleteSubscription,
  getPreferences,
  saveStockAlert,
} from '@/lib/push/push-service';
import { checkRateLimit } from '@/lib/api/rate-limit';

jest.mock('@/lib/push/push-service', () => ({
  saveSubscription: jest.fn(),
  deleteSubscription: jest.fn(),
  getPreferences: jest.fn(),
  updatePreferences: jest.fn(),
  saveStockAlert: jest.fn(),
  deleteStockAlert: jest.fn(),
}));

jest.mock('@/lib/api/rate-limit', () => ({
  RATE_LIMITS: {
    push: { limit: 30, windowSeconds: 60 },
    api: { limit: 60, windowSeconds: 60 },
    form: { limit: 5, windowSeconds: 60 },
    auth: { limit: 10, windowSeconds: 60 },
  },
  checkRateLimit: jest.fn(() => ({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetTime: Date.now() + 60_000,
  })),
}));

const DEFAULT_ENDPOINT = 'https://push.example.com/subscription/abc123';

function makeJsonRequest(path: string, body: Record<string, unknown>) {
  return {
    url: `http://localhost${path}`,
    headers: {
      get(name: string): string | null {
        if (name.toLowerCase() === 'content-type') return 'application/json';
        return null;
      },
    },
    async json() {
      return body;
    },
  };
}

function makeSubscribePayload(endpoint = DEFAULT_ENDPOINT) {
  return {
    endpoint,
    keys: {
      p256dh: 'x'.repeat(80),
      auth: 'y'.repeat(24),
    },
    customerId: 42,
    email: 'test@example.com',
  };
}

async function subscribeAndGetToken(endpoint = DEFAULT_ENDPOINT): Promise<string> {
  const response = await subscribePost(
    makeJsonRequest('/api/push/subscribe', makeSubscribePayload(endpoint)) as never
  );
  const body = await response.json();
  return body.data.ownershipToken as string;
}

describe('push ownership token flow', () => {
  beforeEach(() => {
    process.env.PUSH_ENDPOINT_TOKEN_SECRET = 'unit-test-secret';
    (checkRateLimit as jest.Mock).mockReturnValue({
      allowed: true,
      limit: 30,
      remaining: 29,
      resetTime: Date.now() + 60_000,
    });
    (getPreferences as jest.Mock).mockResolvedValue({
      orderUpdates: true,
      backInStock: true,
      promotions: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns an ownership token on subscribe', async () => {
    const response = await subscribePost(
      makeJsonRequest('/api/push/subscribe', makeSubscribePayload()) as never
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data.ownershipToken).toBe('string');
    expect(body.data.ownershipToken.length).toBeGreaterThan(20);
    expect(saveSubscription).toHaveBeenCalledTimes(1);
  });

  it('rejects preferences request without ownership token', async () => {
    const response = await preferencesPost(
      makeJsonRequest('/api/push/preferences', {
        endpoint: DEFAULT_ENDPOINT,
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.code).toBe('MISSING_OWNERSHIP_TOKEN');
  });

  it('accepts preferences request with valid ownership token', async () => {
    const ownershipToken = await subscribeAndGetToken();

    const response = await preferencesPost(
      makeJsonRequest('/api/push/preferences', {
        endpoint: DEFAULT_ENDPOINT,
        ownershipToken,
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.orderUpdates).toBe(true);
    expect(getPreferences).toHaveBeenCalledWith(DEFAULT_ENDPOINT);
  });

  it('rejects stock alert creation with token from a different endpoint', async () => {
    const ownershipToken = await subscribeAndGetToken(DEFAULT_ENDPOINT);
    const otherEndpoint = 'https://push.example.com/subscription/other-endpoint';

    const response = await stockAlertPost(
      makeJsonRequest('/api/push/stock-alert', {
        endpoint: otherEndpoint,
        ownershipToken,
        productId: 123,
        productName: 'Test Product',
        productSlug: 'test-product',
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.code).toBe('UNAUTHORIZED_ENDPOINT');
    expect(saveStockAlert).not.toHaveBeenCalled();
  });

  it('requires ownership token for unsubscribe delete', async () => {
    const response = await subscribeDelete(
      makeJsonRequest('/api/push/subscribe', {
        endpoint: DEFAULT_ENDPOINT,
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.code).toBe('MISSING_OWNERSHIP_TOKEN');
    expect(deleteSubscription).not.toHaveBeenCalled();
  });

  it('allows unsubscribe delete with valid ownership token', async () => {
    const ownershipToken = await subscribeAndGetToken();

    const response = await subscribeDelete(
      makeJsonRequest('/api/push/subscribe', {
        endpoint: DEFAULT_ENDPOINT,
        ownershipToken,
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(deleteSubscription).toHaveBeenCalledWith(DEFAULT_ENDPOINT);
  });
});
