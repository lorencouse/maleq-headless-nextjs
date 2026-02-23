import { NextRequest, NextResponse } from 'next/server';
import { logDurableEvent } from '@/lib/monitoring/durable-events';

/**
 * POST /api/log-404
 * Logs 404 hits for diagnosis. Writes to Vercel function logs (viewable in dashboard)
 * and returns a simple OK response.
 */
export async function POST(request: NextRequest) {
  try {
    const { path, referrer, userAgent } = await request.json();

    const logEntry = {
      timestamp: new Date().toISOString(),
      path: path || 'unknown',
      referrer: referrer || request.headers.get('referer') || 'direct',
      userAgent: userAgent || request.headers.get('user-agent') || 'unknown',
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    };

    // Log to stdout — visible in Vercel function logs and server console
    console.log('[404]', JSON.stringify(logEntry));

    await logDurableEvent({
      eventType: 'not_found_page_view',
      severity: 'info',
      message: '404 page rendered',
      requestPath: logEntry.path,
      ip: logEntry.ip,
      userAgent: logEntry.userAgent,
      referrer: logEntry.referrer,
      payload: logEntry,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
