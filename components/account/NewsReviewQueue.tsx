'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { fetchAuthed } from '@/lib/api/fetch-authed';

interface PendingDraft {
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

interface QueuedDraft {
  id: number;
  title: string;
  publishAt: string;
  /** 'front' = one of today's picks; 'longterm' = the backlog queued behind them. */
  lane: 'front' | 'longterm';
}

/** The daily front-of-queue quota and the slot times, as reported by the API. */
interface Cadence {
  used: number;
  limit: number;
  slotsLabel: string;
}

/** One entry of the post-repack queue the WP action endpoint returns on every approval. */
interface WpQueueItem {
  id: number;
  title: string;
  publish_at: number;
  lane: 'front' | 'longterm';
}

type CardState = { busy: boolean; status: string; confirmDelete: boolean; expanded: boolean };

/** How many queued stories to list before collapsing the rest into a count. */
const QUEUE_PREVIEW = 10;

function timeAgo(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Slot time in the viewer's timezone: "3:30 PM" today, "Tue 3:30 PM" beyond. */
function slotLabel(iso: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (at.toDateString() === new Date().toDateString()) return time;
  return `${at.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

/**
 * Owner-only approval queue for machine-drafted news posts — the maleq.com
 * mirror of the wp.maleq.com/news-review page. Actions proxy through
 * /api/account/news-review, which validates the session against WP and holds
 * the review key server-side; Publish fires the WP autoshare exactly like
 * publishing in WP admin.
 *
 * Approving never publishes on the spot: stories go out in fixed daily slots. The first
 * few approvals of a day (`frontPicks.limit`) take the earliest slots — today's picks —
 * and every later approval joins the long-term queue behind them, which is what lets one
 * sitting cover several days. Each approval re-packs the queue server-side, so the
 * response carries the whole reordered list rather than just the story you approved.
 */
export default function NewsReviewQueue() {
  const [drafts, setDrafts] = useState<PendingDraft[] | null>(null);
  const [queued, setQueued] = useState<QueuedDraft[]>([]);
  const [cadence, setCadence] = useState<Cadence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<number, CardState>>({});

  useEffect(() => {
    fetchAuthed('/api/account/news-review')
      .then(async (r) => {
        if (r.ok) return r.json();
        // fetchAuthed already flagged the expired session; AccountLayout is
        // redirecting to /login, so don't flash an error on the way out.
        if (r.status === 401) return null;
        if (r.status === 403) throw new Error('This page is only available to the site owner.');
        // Surface what the server actually said (e.g. the missing review key)
        // rather than a bare status code.
        const body = await r.json().catch(() => null);
        throw new Error(
          body?.error
            ? `${body.error} (${r.status})`
            : `Could not load the review queue (${r.status}).`,
        );
      })
      .then((j) => {
        if (!j) return;
        setDrafts(j.drafts);
        setQueued(j.queued ?? []);
        if (j.frontPicks) {
          setCadence({ ...j.frontPicks, slotsLabel: j.slotsLabel ?? '' });
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  const setCard = useCallback((id: number, patch: Partial<CardState>) => {
    setCards((c) => {
      const prev: CardState = c[id] ?? { busy: false, status: '', confirmDelete: false, expanded: false };
      return { ...c, [id]: { ...prev, ...patch } };
    });
  }, []);

  const act = useCallback(
    async (id: number, action: 'publish' | 'delete' | 'later') => {
      setCard(id, { busy: true, status: action === 'publish' ? 'Approving…' : action === 'delete' ? 'Deleting…' : 'Snoozing…' });
      try {
        const r = await fetchAuthed('/api/account/news-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, postId: id }),
        });
        if (r.status === 401) {
          setCard(id, { busy: false, status: '⚠ Session expired — redirecting to sign in…' });
          return;
        }
        const j = await r.json().catch(() => null);
        if (!j?.ok) {
          setCard(id, { busy: false, status: `⚠ ${j.error || 'Action failed'}` });
          return;
        }
        if (action === 'later') {
          setCard(id, { busy: false, status: '' });
          setDrafts((d) => {
            if (!d) return d;
            const snoozedCard = d.find((x) => x.id === id);
            if (!snoozedCard) return d;
            return [...d.filter((x) => x.id !== id), { ...snoozedCard, snoozed: true }];
          });
          return;
        }
        if (action === 'publish' && j.scheduled) {
          // Slotted rather than published now. The server re-packs the whole queue on every
          // approval (a front pick pushes the backlog later), so replace the list wholesale
          // instead of appending this one story to it.
          const publishAt = new Date(Number(j.publish_at) * 1000).toISOString();
          setCard(id, {
            busy: true,
            status:
              j.lane === 'longterm'
                ? `🗓 Long-term queue · ${slotLabel(publishAt)}`
                : `🕒 Queued for ${slotLabel(publishAt)}`,
          });
          if (Array.isArray(j.queue)) {
            setQueued(
              (j.queue as WpQueueItem[])
                .map((q) => ({
                  id: q.id,
                  title: q.title,
                  publishAt: new Date(q.publish_at * 1000).toISOString(),
                  lane: q.lane === 'front' ? ('front' as const) : ('longterm' as const),
                }))
                .sort((a, b) => a.publishAt.localeCompare(b.publishAt)),
            );
          }
          if (typeof j.front_used === 'number' && typeof j.front_limit === 'number') {
            setCadence((c) => ({
              used: j.front_used,
              limit: j.front_limit,
              slotsLabel: c?.slotsLabel ?? '',
            }));
          }
          setTimeout(() => setDrafts((d) => (d ? d.filter((x) => x.id !== id) : d)), 1400);
          return;
        }
        setCard(id, { busy: true, status: action === 'publish' ? '✓ Published, sharing to social…' : '🗑 Deleted' });
        setTimeout(() => setDrafts((d) => (d ? d.filter((x) => x.id !== id) : d)), 800);
      } catch {
        setCard(id, { busy: false, status: '⚠ Network error, try again.' });
      }
    },
    [setCard],
  );

  if (error) {
    return <p className="text-muted-foreground py-8 text-center">{error}</p>;
  }
  if (drafts === null) {
    return <p className="text-muted-foreground py-8 text-center">Loading review queue…</p>;
  }
  // How many of today's front-of-queue picks are left, and when stories actually go out.
  const picksPanel = cadence && (
    <p className="text-sm text-muted-foreground">
      Today&rsquo;s picks{' '}
      <span className="font-semibold text-foreground tabular-nums">
        {cadence.used}/{cadence.limit}
      </span>
      {cadence.used < cadence.limit
        ? ` · the next ${cadence.limit - cadence.used} approval${
            cadence.limit - cadence.used === 1 ? ' jumps' : 's jump'
          } to the front of the queue.`
        : ' · further approvals join the long-term queue.'}
      {cadence.slotsLabel && (
        <>
          <br />
          Publishing at {cadence.slotsLabel}.
        </>
      )}
    </p>
  );

  // The queued panel renders in the empty state too — clearing the draft list is
  // exactly when you want to see what's still waiting to go live.
  const queuedPanel = queued.length > 0 && (
    <section className="border border-border rounded-xl bg-muted/40 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Queued · {queued.length} waiting to go live
      </h2>
      <ol className="space-y-1.5">
        {/* Head of the queue only — the long-term backlog can run weeks deep. */}
        {queued.slice(0, QUEUE_PREVIEW).map((q) => (
          <li key={q.id} className="text-sm flex gap-2">
            <time
              dateTime={q.publishAt}
              className={`tabular-nums shrink-0 w-24 ${
                q.lane === 'front' ? 'text-green-600 dark:text-green-500' : 'text-muted-foreground'
              }`}
            >
              {slotLabel(q.publishAt)}
            </time>
            <span className="min-w-0">
              {q.title}
              {q.lane === 'longterm' && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1 py-0.5 whitespace-nowrap">
                  long-term
                </span>
              )}
            </span>
          </li>
        ))}
        {queued.length > QUEUE_PREVIEW && (
          <li className="text-sm text-muted-foreground">
            +{queued.length - QUEUE_PREVIEW} more further down the queue
          </li>
        )}
      </ol>
    </section>
  );

  if (drafts.length === 0) {
    return (
      <div className="space-y-6">
        {picksPanel}
        {queuedPanel}
        <p className="text-muted-foreground py-8 text-center">All caught up 🎉 No drafts waiting for review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {picksPanel}
      {queuedPanel}
      <p className="text-sm text-muted-foreground">
        {drafts.length} draft{drafts.length === 1 ? '' : 's'} pending review. Nothing publishes on
        approval: stories go out in the fixed daily slots above. Today&rsquo;s picks take the
        earliest slots; approve as many as you like after that and they queue up for the days
        ahead (the Queued list shows exact times). Delete removes the story and its cover image.
      </p>
      {drafts.map((d) => {
        const c = cards[d.id] ?? { busy: false, status: '', confirmDelete: false, expanded: false };
        return (
          <article
            key={d.id}
            className={`border border-border rounded-xl overflow-hidden bg-card ${d.snoozed ? 'opacity-75' : ''}`}
          >
            {d.coverUrl && (
              <div className="relative w-full aspect-[1200/630] bg-muted">
                <Image src={d.coverUrl} alt={d.coverAlt || d.title} fill sizes="(max-width: 768px) 100vw, 680px" className="object-cover" />
              </div>
            )}
            <div className="p-4 sm:p-5">
              <p className="text-xs text-muted-foreground mb-1.5">
                {timeAgo(d.createdAt)}
                {d.sourceName && (
                  <>
                    {' · '}
                    {d.sourceUrl ? (
                      <a href={d.sourceUrl} target="_blank" rel="noopener nofollow" className="underline hover:text-foreground">
                        {d.sourceName} ↗
                      </a>
                    ) : (
                      d.sourceName
                    )}
                  </>
                )}
                {d.snoozed && ' · ⏰ snoozed'}
              </p>
              <h2 className="text-lg font-semibold leading-snug mb-2">{d.title}</h2>
              {d.socialText && <p className="text-sm italic text-muted-foreground mb-3">“{d.socialText}”</p>}
              <div className={`relative ${c.expanded ? '' : 'max-h-32 overflow-hidden'}`}>
                <div
                  className="prose prose-sm dark:prose-invert max-w-none [&_.pullquote]:border-l-4 [&_.pullquote]:pl-3 [&_aside]:bg-muted [&_aside]:rounded-lg [&_aside]:p-3 [&_aside]:my-3"
                  dangerouslySetInnerHTML={{ __html: d.contentHtml }}
                />
                {!c.expanded && (
                  <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-card to-transparent" />
                )}
              </div>
              <button
                type="button"
                onClick={() => setCard(d.id, { expanded: !c.expanded })}
                className="mt-2 text-sm text-muted-foreground underline"
              >
                {c.expanded ? 'Collapse ▴' : 'Read full story ▾'}
              </button>

              <div className="grid grid-cols-3 gap-2 mt-4">
                <button
                  type="button"
                  disabled={c.busy}
                  onClick={() => act(d.id, 'publish')}
                  className="py-2.5 rounded-lg font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                >
                  ✓ Publish
                </button>
                <button
                  type="button"
                  disabled={c.busy}
                  onClick={() => act(d.id, 'later')}
                  className="py-2.5 rounded-lg font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
                >
                  ⏰ Later
                </button>
                <button
                  type="button"
                  disabled={c.busy}
                  onClick={() => {
                    if (!c.confirmDelete) {
                      setCard(d.id, { confirmDelete: true });
                      setTimeout(() => setCard(d.id, { confirmDelete: false }), 3500);
                      return;
                    }
                    act(d.id, 'delete');
                  }}
                  className={`py-2.5 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 ${
                    c.confirmDelete ? 'ring-2 ring-red-400 ring-offset-1' : ''
                  }`}
                >
                  {c.confirmDelete ? 'Tap to confirm' : '🗑 Delete'}
                </button>
              </div>
              {c.status && <p className="mt-2 text-sm text-muted-foreground">{c.status}</p>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
