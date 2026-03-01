import { NextResponse } from 'next/server';
import { successResponse } from './response';

const MIN_SUBMIT_TIME_MS = 3000;

/**
 * Check for spam indicators in form submissions.
 * Returns a fake success response if spam is detected (to not tip off bots),
 * or null if the submission looks legitimate.
 */
export function checkSpam(body: {
  website?: string;
  _t?: number;
}, fakeMessage: string): NextResponse | null {
  // Honeypot field filled — bots auto-fill hidden fields
  if (body.website) {
    return successResponse(undefined, fakeMessage);
  }

  // Form submitted too fast (< 3 seconds) — no human does this
  if (body._t && Date.now() - Number(body._t) < MIN_SUBMIT_TIME_MS) {
    return successResponse(undefined, fakeMessage);
  }

  return null;
}
