import { resolveGATrackingId } from '@/lib/analytics/gtag';

describe('GA tracking config resolution', () => {
  it('uses NEXT_PUBLIC_GA_ID when both variables are set to the same value', () => {
    const result = resolveGATrackingId('G-ABC123', 'G-ABC123');
    expect(result.trackingId).toBe('G-ABC123');
    expect(result.hasMismatch).toBe(false);
  });

  it('uses NEXT_PUBLIC_GA_ID when variables differ and flags mismatch', () => {
    const result = resolveGATrackingId('G-PRIMARY', 'G-FALLBACK');
    expect(result.trackingId).toBe('G-PRIMARY');
    expect(result.hasMismatch).toBe(true);
  });

  it('falls back to NEXT_PUBLIC_GA_TRACKING_ID when NEXT_PUBLIC_GA_ID is missing', () => {
    const result = resolveGATrackingId('', 'G-FALLBACK');
    expect(result.trackingId).toBe('G-FALLBACK');
    expect(result.hasMismatch).toBe(false);
  });

  it('returns empty tracking id when both values are missing', () => {
    const result = resolveGATrackingId(undefined, undefined);
    expect(result.trackingId).toBe('');
    expect(result.hasMismatch).toBe(false);
  });
});
