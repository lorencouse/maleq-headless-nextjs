import {
  encodeAuthToken,
  decodeAuthToken,
  extractAuthToken,
  SESSION_COOKIE_NAME,
} from '@/lib/api/auth-token';

/** Build a plain Web Request with the given headers for extractAuthToken(). */
function reqWith(headers: Record<string, string>): Request {
  return new Request('https://example.com/api/test', { headers });
}

describe('auth-token encode/decode', () => {
  it('round-trips userId + rawToken', () => {
    const token = encodeAuthToken(123, 'rawsecret');
    expect(decodeAuthToken(token)).toEqual({ userId: 123, rawToken: 'rawsecret' });
  });

  it('rejects malformed / non-positive / missing-raw tokens', () => {
    expect(decodeAuthToken('not-base64-with-no-colon')).toBeNull();
    expect(decodeAuthToken(Buffer.from('0:tok').toString('base64'))).toBeNull();
    expect(decodeAuthToken(Buffer.from('abc:tok').toString('base64'))).toBeNull();
    expect(decodeAuthToken(Buffer.from('5:').toString('base64'))).toBeNull();
  });

  it('preserves a rawToken containing colons', () => {
    const token = encodeAuthToken(7, 'a:b:c');
    expect(decodeAuthToken(token)).toEqual({ userId: 7, rawToken: 'a:b:c' });
  });
});

describe('extractAuthToken cookie/header precedence', () => {
  const cookieToken = encodeAuthToken(42, 'cookie-raw');
  const headerToken = encodeAuthToken(99, 'header-raw');

  it('reads the token from the session cookie', () => {
    const r = reqWith({ cookie: `${SESSION_COOKIE_NAME}=${cookieToken}` });
    expect(extractAuthToken(r)).toEqual({ userId: 42, rawToken: 'cookie-raw' });
  });

  it('reads from cookie even alongside other cookies', () => {
    const r = reqWith({ cookie: `foo=bar; ${SESSION_COOKIE_NAME}=${cookieToken}; baz=qux` });
    expect(extractAuthToken(r)).toEqual({ userId: 42, rawToken: 'cookie-raw' });
  });

  it('prefers the cookie over the Authorization header', () => {
    const r = reqWith({
      cookie: `${SESSION_COOKIE_NAME}=${cookieToken}`,
      authorization: `Bearer ${headerToken}`,
    });
    expect(extractAuthToken(r)).toEqual({ userId: 42, rawToken: 'cookie-raw' });
  });

  it('falls back to the Authorization header when no cookie present', () => {
    const r = reqWith({ authorization: `Bearer ${headerToken}` });
    expect(extractAuthToken(r)).toEqual({ userId: 99, rawToken: 'header-raw' });
  });

  it('ignores a "Bearer null" header and uses the cookie (the post-migration case)', () => {
    const r = reqWith({
      cookie: `${SESSION_COOKIE_NAME}=${cookieToken}`,
      authorization: 'Bearer null',
    });
    expect(extractAuthToken(r)).toEqual({ userId: 42, rawToken: 'cookie-raw' });
  });

  it('returns null when neither cookie nor header is present', () => {
    expect(extractAuthToken(reqWith({}))).toBeNull();
  });

  it('returns null for a malformed cookie value and no header', () => {
    const r = reqWith({ cookie: `${SESSION_COOKIE_NAME}=garbage` });
    expect(extractAuthToken(r)).toBeNull();
  });
});
