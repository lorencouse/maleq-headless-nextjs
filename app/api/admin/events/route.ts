import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { verifyAdminAuth } from '@/lib/api/admin-auth';
import { getPoolAsync } from '@/lib/db/pool';

interface EventRow extends RowDataPacket {
  id: number;
  event_type: string;
  event_source: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  event_id: string | null;
  payment_intent_id: string | null;
  order_id: number | null;
  request_path: string | null;
  ip: string | null;
  user_agent: string | null;
  referrer: string | null;
  payload_json: string | null;
  created_at: string;
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toMySqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export async function GET(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  try {
    const search = request.nextUrl.searchParams;
    const limit = Math.min(parsePositiveInt(search.get('limit'), 100), 500);
    const sinceHours = Math.min(parsePositiveInt(search.get('sinceHours'), 168), 24 * 365);
    const eventType = search.get('eventType');
    const severity = search.get('severity');
    const includePayload = search.get('includePayload') === '1';

    const cutoff = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    const whereClauses: string[] = ['created_at >= ?'];
    const params: Array<string | number> = [toMySqlDateTime(cutoff)];

    if (eventType) {
      whereClauses.push('event_type = ?');
      params.push(eventType);
    }

    if (severity && ['info', 'warning', 'error'].includes(severity)) {
      whereClauses.push('severity = ?');
      params.push(severity);
    }

    params.push(limit);

    const pool = await getPoolAsync();
    const [rows] = await pool.execute<EventRow[]>(
      `SELECT
        id,
        event_type,
        event_source,
        severity,
        message,
        event_id,
        payment_intent_id,
        order_id,
        request_path,
        ip,
        user_agent,
        referrer,
        payload_json,
        created_at
      FROM maleq_event_log
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY id DESC
      LIMIT ?`,
      params
    );

    const events = rows.map((row) => {
      let payload: unknown = null;
      if (includePayload && row.payload_json) {
        try {
          payload = JSON.parse(row.payload_json);
        } catch {
          payload = row.payload_json;
        }
      }

      return {
        id: row.id,
        eventType: row.event_type,
        source: row.event_source,
        severity: row.severity,
        message: row.message,
        eventId: row.event_id,
        paymentIntentId: row.payment_intent_id,
        orderId: row.order_id,
        requestPath: row.request_path,
        ip: row.ip,
        userAgent: row.user_agent,
        referrer: row.referrer,
        createdAt: row.created_at,
        ...(includePayload ? { payload } : {}),
      };
    });

    return NextResponse.json({
      success: true,
      count: events.length,
      filters: { limit, sinceHours, eventType: eventType || null, severity: severity || null, includePayload },
      events,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch event logs';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
