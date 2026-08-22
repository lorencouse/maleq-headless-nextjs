import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise';
import { requireOwner } from '@/lib/api/owner-auth';
import { getPoolAsync } from '@/lib/db/pool';
import { getWpBaseUrl } from '@/lib/db/wp-url';
import { getProductionImageUrl } from '@/lib/utils/image';

export const dynamic = 'force-dynamic';

export interface PendingDraft {
  id: number;
  title: string;
  contentHtml: string;
  coverUrl: string | null;
  coverAlt: string;
  sourceName: string;
  sourceUrl: string;
  socialText: string;
  snoozed: boolean;
  createdAt: string;
}

/** An approved story waiting for its publish slot (post_status = 'future'). */
export interface QueuedDraft {
  id: number;
  title: string;
  /** Scheduled publish time, ISO 8601 UTC. */
  publishAt: string;
  /** 'front' = one of today's picks (earliest slots); 'longterm' = the backlog behind them. */
  lane: 'front' | 'longterm';
}

/** Timezone the fixed publish slots are expressed in — mirrors MALEQ_NEWS_PUBLISH_TZ. */
const SLOT_TZ = 'America/New_York';
/** Shown until the mu-plugin has written the cadence option (see maleq_nr_publish_cadence). */
const CADENCE_FALLBACK = { limit: 5, slotsLabel: '9 AM, 12 PM, 3 PM, 6 PM, 9 PM ET' };

/** Minutes east of UTC for `tz` at instant `at` (e.g. -240 during EDT). */
function zoneOffsetMinutes(tz: string, at: Date): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/**
 * Unix seconds bracketing the calendar day `at` falls in, in the slot timezone — the window
 * the daily front-pick quota is counted over (same rule as maleq_nr_today_range_gmt()).
 */
function slotDayRange(at: Date): [number, number] {
  const midnight = (d: Date): number => {
    // Two passes: the offset at `d` gives the calendar date, but midnight itself can sit on
    // the other side of a DST change (a spring-forward day starts on the old offset).
    const guess = zoneOffsetMinutes(SLOT_TZ, d);
    const local = new Date(d.getTime() + guess * 60_000);
    const naive = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    const off = zoneOffsetMinutes(SLOT_TZ, new Date(naive - guess * 60_000));
    return naive - off * 60_000;
  };
  const start = midnight(at);
  // +26h lands inside the next day whether it runs 23, 24 or 25 hours; snap back to its midnight.
  return [Math.floor(start / 1000), Math.floor(midnight(new Date(start + 26 * 3_600_000)) / 1000)];
}

/**
 * GET — the pending news-draft queue (owner only). Mirrors the query in the
 * maleq-news-review.php mu-plugin: drafts flagged `_maleq_news_pending_review`,
 * snoozed items (`_maleq_news_review_later`) sorted last, newest first.
 *
 * Also returns `queued`: stories already approved but waiting for their publish
 * slot (`post_status = 'future'` — see the fixed-slot queue in the mu-plugin), each
 * tagged with its lane, plus `frontPicks`, the daily front-of-queue quota. They keep
 * the pending-review meta until autoshare clears it post-share, so the list
 * self-empties as stories go live.
 */
export async function GET(request: NextRequest) {
  const owner = await requireOwner(request);
  if (owner instanceof NextResponse) return owner;

  try {
    return await loadQueue();
  } catch (e) {
    // Without this the client only sees Next's HTML 500 page and can report a
    // bare status code; surface the real reason instead.
    console.error('news-review queue load failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load the review queue' },
      { status: 500 },
    );
  }
}

/**
 * Prefer the GMT column (already UTC); fall back to the site-local one when
 * post_date_gmt is a zero date. Returns null if neither is usable.
 */
function rowIso(row: RowDataPacket): string | null {
  for (const raw of [row.date_utc, row.date_site]) {
    if (!raw) continue;
    const ms = Date.parse(String(raw));
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  return null;
}

async function loadQueue(): Promise<NextResponse> {
  const pool = await getPoolAsync();
  const [rows] = await pool.query<RowDataPacket[]>(
    // Dates come back as pre-formatted UTC ISO strings: mysql2 hands DATETIME
    // columns back as JS Date objects re-interpreted in the server's timezone,
    // which is both wrong for a GMT column and unparseable if re-stringified.
    `SELECT p.ID, p.post_title, p.post_content, p.post_status,
            DATE_FORMAT(p.post_date_gmt, '%Y-%m-%dT%H:%i:%sZ') AS date_utc,
            DATE_FORMAT(p.post_date, '%Y-%m-%dT%H:%i:%sZ') AS date_site,
            thumb.guid AS thumb_url,
            alt.meta_value AS thumb_alt,
            src_name.meta_value AS source_name,
            src_url.meta_value AS source_url,
            social.meta_value AS social_text,
            later.meta_value AS snoozed_at,
            lane.meta_value AS queue_lane
       FROM wp_posts p
       JOIN wp_postmeta pending
         ON pending.post_id = p.ID AND pending.meta_key = '_maleq_news_pending_review' AND pending.meta_value = '1'
       LEFT JOIN wp_postmeta pm_thumb ON pm_thumb.post_id = p.ID AND pm_thumb.meta_key = '_thumbnail_id'
       LEFT JOIN wp_posts thumb ON thumb.ID = pm_thumb.meta_value
       LEFT JOIN wp_postmeta alt ON alt.post_id = thumb.ID AND alt.meta_key = '_wp_attachment_image_alt'
       LEFT JOIN wp_postmeta src_name ON src_name.post_id = p.ID AND src_name.meta_key = '_maleq_news_source_name'
       LEFT JOIN wp_postmeta src_url ON src_url.post_id = p.ID AND src_url.meta_key = '_maleq_news_source_url'
       LEFT JOIN wp_postmeta social ON social.post_id = p.ID AND social.meta_key = '_maleq_news_social_text'
       LEFT JOIN wp_postmeta later ON later.post_id = p.ID AND later.meta_key = '_maleq_news_review_later'
       LEFT JOIN wp_postmeta lane ON lane.post_id = p.ID AND lane.meta_key = '_maleq_news_queue_lane'
      WHERE p.post_type = 'post' AND p.post_status IN ('draft', 'future')
      ORDER BY (later.meta_value IS NOT NULL) ASC, p.post_date DESC
      -- Drafts plus a long-term queue that is meant to run days deep.
      LIMIT 250`,
  );

  const drafts: PendingDraft[] = rows
    .filter((r) => r.post_status === 'draft')
    .map((r) => ({
      id: Number(r.ID),
      title: String(r.post_title),
      contentHtml: String(r.post_content || ''),
      coverUrl: r.thumb_url ? getProductionImageUrl(String(r.thumb_url)) : null,
      coverAlt: String(r.thumb_alt || ''),
      sourceName: String(r.source_name || ''),
      sourceUrl: String(r.source_url || ''),
      socialText: String(r.social_text || ''),
      snoozed: r.snoozed_at != null,
      createdAt: rowIso(r) ?? new Date().toISOString(),
    }));

  // Soonest-first: this is a countdown, not a feed. A row with an unusable
  // slot is dropped rather than allowed to break the whole queue.
  const queued: QueuedDraft[] = rows
    .filter((r) => r.post_status === 'future')
    .map((r) => {
      const publishAt = rowIso(r);
      if (!publishAt) return null;
      return {
        id: Number(r.ID),
        title: String(r.post_title),
        publishAt,
        lane: String(r.queue_lane) === '1' ? ('front' as const) : ('longterm' as const),
      };
    })
    .filter((q): q is QueuedDraft => q !== null)
    .sort((a, b) => a.publishAt.localeCompare(b.publishAt));

  return NextResponse.json({ drafts, queued, ...(await loadCadence(pool)) });
}

/**
 * The daily front-pick quota: how many stories have been approved so far today (slot
 * timezone) out of the allowance that jumps the long-term queue. `used` is counted from the
 * approval stamps — the same rule the mu-plugin applies when it assigns a lane — while the
 * limit and the human slot list come from the cadence option the mu-plugin mirrors out of
 * wp-config, so this route never restates the schedule.
 */
async function loadCadence(pool: Awaited<ReturnType<typeof getPoolAsync>>) {
  const [start, end] = slotDayRange(new Date());
  const [[tally]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS used
       FROM wp_postmeta pm
       INNER JOIN wp_posts p ON p.ID = pm.post_id
      WHERE pm.meta_key = '_maleq_news_approved_at'
        AND CAST(pm.meta_value AS UNSIGNED) >= ?
        AND CAST(pm.meta_value AS UNSIGNED) < ?
        AND p.post_status IN ('publish', 'future')`,
    [start, end],
  );
  const [[option]] = await pool.query<RowDataPacket[]>(
    `SELECT option_value FROM wp_options WHERE option_name = 'maleq_news_review_cadence' LIMIT 1`,
  );
  let limit = CADENCE_FALLBACK.limit;
  let slotsLabel = CADENCE_FALLBACK.slotsLabel;
  try {
    const cadence = option ? JSON.parse(String(option.option_value)) : null;
    if (Number.isInteger(cadence?.limit)) limit = cadence.limit;
    if (typeof cadence?.slots_label === 'string' && cadence.slots_label) slotsLabel = cadence.slots_label;
  } catch {
    // Malformed option: fall back to the defaults rather than failing the whole queue.
  }
  return {
    frontPicks: { used: Math.min(limit, Number(tally?.used ?? 0)), limit },
    slotsLabel,
  };
}

const ACTIONS = new Set(['publish', 'delete', 'later']);

/**
 * POST — proxy a review action to the WP mu-plugin endpoint, with the review
 * key held server-side. Publishing through WP (rather than flipping the row
 * here) is deliberate: it fires maleq-news-autoshare.php exactly like WP admin,
 * and delete gets the safe cover-attachment cleanup + trash-not-purge logic.
 */
export async function POST(request: NextRequest) {
  const owner = await requireOwner(request);
  if (owner instanceof NextResponse) return owner;

  const key = process.env.MALEQ_NEWS_REVIEW_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, error: 'MALEQ_NEWS_REVIEW_KEY is not configured on the server' },
      { status: 500 },
    );
  }

  let body: { action?: string; postId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  const action = String(body.action || '');
  const postId = Number(body.postId);
  if (!ACTIONS.has(action) || !Number.isInteger(postId) || postId < 1) {
    return NextResponse.json({ ok: false, error: 'Invalid action or postId' }, { status: 400 });
  }

  let wpRes: Response;
  try {
    wpRes = await fetch(`${getWpBaseUrl()}/news-review-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: key, action, post_id: postId }),
      cache: 'no-store',
    });
  } catch (e) {
    console.error('news-review action failed to reach WordPress:', e);
    return NextResponse.json({ ok: false, error: 'Could not reach WordPress' }, { status: 502 });
  }
  const data = await wpRes.json().catch(() => ({ ok: false, error: 'Bad response from WordPress' }));
  return NextResponse.json(data, { status: wpRes.status });
}
