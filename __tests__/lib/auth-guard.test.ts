import {
  isReservedAuthIdentifier,
  normalizeAuthIdentifier,
} from '@/lib/security/auth-guard';

describe('auth-guard identifier checks', () => {
  it('normalizes identifier safely', () => {
    expect(normalizeAuthIdentifier('  Admin@Maleq.com ')).toBe('admin@maleq.com');
  });

  it('caps normalized identifier length', () => {
    const longInput = `user-${'x'.repeat(400)}@example.com`;
    expect(normalizeAuthIdentifier(longInput).length).toBeLessThanOrEqual(254);
  });

  it('blocks reserved usernames and emails', () => {
    expect(isReservedAuthIdentifier('admin')).toBe(true);
    expect(isReservedAuthIdentifier('root')).toBe(true);
    expect(isReservedAuthIdentifier('admin123')).toBe(true);
    expect(isReservedAuthIdentifier('admin@maleq.com')).toBe(true);
    expect(isReservedAuthIdentifier('webmaster@maleq.com')).toBe(true);
    expect(isReservedAuthIdentifier('support@wp.maleq.com')).toBe(true);
  });

  it('allows non-reserved identifiers', () => {
    expect(isReservedAuthIdentifier('shopper@example.com')).toBe(false);
    expect(isReservedAuthIdentifier('jane.doe')).toBe(false);
  });
});
