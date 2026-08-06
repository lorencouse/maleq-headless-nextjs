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
}

/**
 * GET — the pending news-draft queue (owner only). Mirrors the query in the
 * maleq-news-review.php mu-plugin: drafts flagged `_maleq_news_pending_review`,
 * snoozed items (`_maleq_news_review_later`) sorted last, newest first.
 *
 * Also returns `queued`: stories already approved but waiting for their publish
 * slot (`post_status = 'future'` — see the publish-spacing logic in the
 * mu-plugin). They keep the pending-review meta until autoshare clears it
 * post-share, so the list self-empties as stories go live.
 */
export async function GET(request: NextRequest) {
  const owner = await requireOwner(request);
  if (owner instanceof NextResponse) return owner;

  const pool = await getPoolAsync();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.ID, p.post_title, p.post_content, p.post_date, p.post_date_gmt, p.post_status,
            thumb.guid AS thumb_url,
            alt.meta_value AS thumb_alt,
            src_name.meta_value AS source_name,
            src_url.meta_value AS source_url,
            social.meta_value AS social_text,
            later.meta_value AS snoozed_at
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
      WHERE p.post_type = 'post' AND p.post_status IN ('draft', 'future')
      ORDER BY (later.meta_value IS NOT NULL) ASC, p.post_date DESC
      LIMIT 50`,
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
      createdAt: new Date(r.post_date).toISOString(),
    }));

  // Soonest-first: this is a countdown, not a feed.
  const queued: QueuedDraft[] = rows
    .filter((r) => r.post_status === 'future')
    .map((r) => ({
      id: Number(r.ID),
      title: String(r.post_title),
      // post_date_gmt is already UTC; stamp it as such so the client renders it
      // in the viewer's timezone rather than re-interpreting it as local.
      publishAt: new Date(`${String(r.post_date_gmt).replace(' ', 'T')}Z`).toISOString(),
    }))
    .sort((a, b) => a.publishAt.localeCompare(b.publishAt));

  return NextResponse.json({ drafts, queued });
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

  const wpRes = await fetch(`${getWpBaseUrl()}/news-review-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ k: key, action, post_id: postId }),
    cache: 'no-store',
  });
  const data = await wpRes.json().catch(() => ({ ok: false, error: 'Bad response from WordPress' }));
  return NextResponse.json(data, { status: wpRes.status });
}
