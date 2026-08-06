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
}

type CardState = { busy: boolean; status: string; confirmDelete: boolean; expanded: boolean };

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
 */
export default function NewsReviewQueue() {
  const [drafts, setDrafts] = useState<PendingDraft[] | null>(null);
  const [queued, setQueued] = useState<QueuedDraft[]>([]);
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
          // Spaced out rather than published now — surface the slot and move the
          // story into the Queued list so the cadence stays visible.
          const publishAt = new Date(Number(j.publish_at) * 1000).toISOString();
          const title = drafts?.find((x) => x.id === id)?.title ?? '';
          setCard(id, { busy: true, status: `🕒 Queued for ${slotLabel(publishAt)}` });
          setQueued((q) =>
            [...q, { id, title, publishAt }].sort((a, b) => a.publishAt.localeCompare(b.publishAt)),
          );
          setTimeout(() => setDrafts((d) => (d ? d.filter((x) => x.id !== id) : d)), 1400);
          return;
        }
        setCard(id, { busy: true, status: action === 'publish' ? '✓ Published, sharing to social…' : '🗑 Deleted' });
        setTimeout(() => setDrafts((d) => (d ? d.filter((x) => x.id !== id) : d)), 800);
      } catch {
        setCard(id, { busy: false, status: '⚠ Network error, try again.' });
      }
    },
    [setCard, drafts],
  );

  if (error) {
    return <p className="text-muted-foreground py-8 text-center">{error}</p>;
  }
  if (drafts === null) {
    return <p className="text-muted-foreground py-8 text-center">Loading review queue…</p>;
  }
  // The queued panel renders in the empty state too — clearing the draft list is
  // exactly when you want to see what's still waiting to go live.
  const queuedPanel = queued.length > 0 && (
    <section className="border border-border rounded-xl bg-muted/40 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Queued · {queued.length} waiting to go live
      </h2>
      <ol className="space-y-1.5">
        {queued.map((q) => (
          <li key={q.id} className="text-sm flex gap-2">
            <time
              dateTime={q.publishAt}
              className="text-muted-foreground tabular-nums shrink-0 w-20"
            >
              {slotLabel(q.publishAt)}
            </time>
            <span className="min-w-0">{q.title}</span>
          </li>
        ))}
      </ol>
    </section>
  );

  if (drafts.length === 0) {
    return (
      <div className="space-y-6">
        {queuedPanel}
        <p className="text-muted-foreground py-8 text-center">All caught up 🎉 No drafts waiting for review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {queuedPanel}
      <p className="text-sm text-muted-foreground">
        {drafts.length} draft{drafts.length === 1 ? '' : 's'} pending review. Approved stories are spaced
        out — the first goes out now, the rest queue up (the Queued list shows exact times). Delete
        removes the story and its cover image.
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
