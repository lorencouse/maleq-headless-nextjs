'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import Image from 'next/image';
import {
  DECISION_TREE,
  getChildrenAtPath,
  type TreeNode,
} from '@/lib/chatbot/decision-tree';
import { trackChatbot } from '@/lib/analytics/gtag';

type Role = 'user' | 'assistant';
type Mode = 'guided' | 'ai';
type Message = { id: string; role: Role; content: string };

type DiscoveryFilters = {
  material?: string;
  color?: string;
  priceBand?: string;
};

type DiscoveryProduct = {
  id: number;
  name: string;
  url: string;
  price: number | null;
  onSale: boolean;
  brand: string | null;
  material: string | null;
  inStock: boolean;
  image: string | null;
  rating: number | null;
  reviewCount: number;
};

type DiscoveryArticle = { title: string; url: string; excerpt: string | null };

type DiscoveryData = {
  products: DiscoveryProduct[];
  totalMatches: number;
  articles: DiscoveryArticle[];
  facets: {
    materials: { slug: string; name: string; count: number }[];
    colors: { slug: string; name: string; count: number }[];
    priceBands: { id: string; label: string }[];
  };
};

type Discovery = {
  nodeId: string;
  label: string;
  query: string;
  filters: DiscoveryFilters;
  data: DiscoveryData | null;
  loading: boolean;
};

const STORAGE_KEY = 'maleq-chat-state';
/**
 * Bump this whenever the decision-tree structure, persisted Message shape, or
 * Mode semantics change in a way that would make old state confusing or
 * unreachable (e.g. a node that was 'escalate' becoming 'category'). Old state
 * with a mismatched version is ignored on hydration, so the user lands in a
 * clean default rather than stuck mode.
 */
const STATE_VERSION = 3;

type Persisted = {
  version: number;
  mode: Mode;
  path: string[];
  messages: Message[];
  feedbackPending: boolean;
};

function newId() {
  return Math.random().toString(36).slice(2);
}

// Renders [label](/path) markdown links and **bold** as React nodes.
// Only internal paths (starting with /) become links — everything else is plain text.
// No raw HTML is interpreted.
function renderContent(text: string): React.ReactNode[] {
  const linkRe = /\[([^\]]+)\]\((\/[^\s)]*)\)/g;
  const boldRe = /\*\*([^*]+)\*\*/g;
  const out: React.ReactNode[] = [];
  let key = 0;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  // First pass: collect link spans
  const links: { start: number; end: number; label: string; href: string }[] = [];
  while ((m = linkRe.exec(text)) !== null) {
    links.push({ start: m.index, end: m.index + m[0].length, label: m[1], href: m[2] });
  }

  const renderBoldSegment = (segment: string): React.ReactNode => {
    if (!segment.includes('**')) return segment;
    const parts: React.ReactNode[] = [];
    let last = 0;
    let bm: RegExpExecArray | null;
    boldRe.lastIndex = 0;
    while ((bm = boldRe.exec(segment)) !== null) {
      if (bm.index > last) parts.push(segment.slice(last, bm.index));
      parts.push(<strong key={`b-${key++}`}>{bm[1]}</strong>);
      last = bm.index + bm[0].length;
    }
    if (last < segment.length) parts.push(segment.slice(last));
    return <>{parts}</>;
  };

  for (const l of links) {
    if (l.start > lastIndex) {
      out.push(renderBoldSegment(text.slice(lastIndex, l.start)));
    }
    out.push(
      <Link
        key={`l-${key++}`}
        href={l.href}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 font-medium underline-offset-2 hover:underline transition-colors"
      >
        {l.label}
      </Link>
    );
    lastIndex = l.end;
  }
  if (lastIndex < text.length) {
    out.push(renderBoldSegment(text.slice(lastIndex)));
  }
  return out;
}

export default function ChatWidget() {
  const t = useTranslations('chat');

  // Localized display text for a decision-tree node. The tree's English
  // literals (lib/chatbot/decision-tree.ts) stay the source of truth + the
  // analytics label; translations live under chat.tree keyed by the node's
  // id-PATH (e.g. orders.track-order.answer) so colliding ids like `lube`
  // stay distinct. Missing key → fall back to the English literal, which is
  // how `en` and the untranslated `ja` placeholder render.
  const treeText = useCallback(
    (idPath: string[], leaf: 'label' | 'answer' | 'transition', fallback: string) => {
      const key = `tree.${idPath.join('.')}.${leaf}`;
      return t.has(key) ? t(key) : fallback;
    },
    [t]
  );
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('guided');
  const [path, setPath] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  // Discovery state is NOT persisted to localStorage — it's transient.
  const [discovery, setDiscovery] = useState<Discovery | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Last answered node so feedback events can attribute helpful/unhelpful to a specific Q. */
  const lastAnswerRef = useRef<{ id: string; parentId: string } | null>(null);
  /** Count of free-text AI messages in this session (for analytics ordering). */
  const aiMessageCountRef = useRef(0);

  // Hydrate from storage. Old-versioned state is discarded silently so the
  // user lands on a clean default rather than a stuck mode.
  useEffect(() => {
    try {
      // Clean up keys from earlier versions of this widget. Cheap one-time op.
      localStorage.removeItem('maleq-chat-history-v1');
      localStorage.removeItem('maleq-chat-state-v2');

      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<Persisted>;
      if (p.version !== STATE_VERSION) return;
      if (p.mode === 'ai' || p.mode === 'guided') setMode(p.mode);
      if (Array.isArray(p.path)) setPath(p.path.filter((x) => typeof x === 'string'));
      if (Array.isArray(p.messages)) setMessages(p.messages.filter((m) => m && typeof m === 'object'));
      if (typeof p.feedbackPending === 'boolean') setFeedbackPending(p.feedbackPending);
    } catch {
      // ignore
    }
  }, []);

  // Persist on every change
  useEffect(() => {
    try {
      const data: Persisted = { version: STATE_VERSION, mode, path, messages, feedbackPending };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  }, [mode, path, messages, feedbackPending]);

  // Auto-scroll to bottom on any change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, mode, path, feedbackPending]);

  // Focus input when AI mode opens
  useEffect(() => {
    if (open && mode === 'ai') {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, mode]);

  const currentPills = useMemo(() => getChildrenAtPath(path), [path]);

  const reset = useCallback(() => {
    trackChatbot('chatbot_reset', {
      mode_before: mode,
      depth_before: path.length,
    });
    abortRef.current?.abort();
    setMode('guided');
    setPath([]);
    setMessages([]);
    setFeedbackPending(false);
    setInput('');
    setDiscovery(null);
    lastAnswerRef.current = null;
    aiMessageCountRef.current = 0;
  }, [mode, path.length]);

  const backToTopics = useCallback(() => {
    trackChatbot('chatbot_reset', {
      mode_before: 'ai',
      depth_before: 0,
      via: 'back_to_topics',
    });
    setMode('guided');
    setPath([]);
    setFeedbackPending(false);
    setDiscovery(null);
  }, []);

  // Fetch (or refetch) discovery data for a query + filters.
  const fetchDiscovery = useCallback(
    async (query: string, filters: DiscoveryFilters) => {
      try {
        const res = await fetch('/api/chat/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, filters }),
        });
        if (!res.ok) throw new Error('discover failed');
        const data = (await res.json()) as DiscoveryData;
        setDiscovery((cur) =>
          cur && cur.query === query ? { ...cur, filters, data, loading: false } : cur
        );
      } catch (err) {
        console.error('[chat] discover fetch failed:', err);
        setDiscovery((cur) =>
          cur && cur.query === query ? { ...cur, loading: false } : cur
        );
      }
    },
    []
  );

  const enterDiscovery = useCallback(
    (node: Extract<TreeNode, { type: 'product-finder' }>, localizedLabel: string) => {
      const labelLower = localizedLabel.toLowerCase();
      setMessages((cur) => [
        ...cur,
        { id: newId(), role: 'user', content: localizedLabel },
        {
          id: newId(),
          role: 'assistant',
          content: t('discoveryIntro', { label: labelLower }),
        },
      ]);
      setDiscovery({
        nodeId: node.id,
        // Display label is localized; node.query stays English (the product
        // index is English-keyed) for the actual search.
        label: localizedLabel,
        query: node.query,
        filters: {},
        data: null,
        loading: true,
      });
      fetchDiscovery(node.query, {});
    },
    [fetchDiscovery, t]
  );

  const applyDiscoveryFilter = useCallback(
    (key: keyof DiscoveryFilters, value: string) => {
      setDiscovery((cur) => {
        if (!cur) return cur;
        const filters = { ...cur.filters };
        const toggling = filters[key] === value;
        if (toggling) delete filters[key];
        else filters[key] = value;

        trackChatbot('chatbot_filter_apply', {
          filter_key: key,
          filter_value: value,
          toggled_off: toggling,
          source_id: cur.nodeId,
        });

        fetchDiscovery(cur.query, filters);
        return { ...cur, filters, loading: true };
      });
    },
    [fetchDiscovery]
  );

  const exitDiscoveryToAi = useCallback(() => {
    const d = discovery;
    if (!d) return;

    trackChatbot('chatbot_escalated', {
      reason: 'discovery_to_ai',
      source_id: d.nodeId,
      depth: path.length,
      material: d.filters.material,
      color: d.filters.color,
      price_band: d.filters.priceBand,
    });

    const filterParts: string[] = [];
    if (d.filters.material) filterParts.push(t('filterDescMaterial', { value: d.filters.material }));
    if (d.filters.color) filterParts.push(t('filterDescColor', { value: d.filters.color }));
    if (d.filters.priceBand) filterParts.push(t('filterDescPrice', { value: d.filters.priceBand }));
    const filterDesc = filterParts.length > 0 ? ` (${filterParts.join(', ')})` : '';

    const transition = t('discoveryToAi', {
      label: d.label.toLowerCase(),
      filterDesc,
    });

    setMessages((cur) => [
      ...cur,
      { id: newId(), role: 'assistant', content: transition },
    ]);
    setMode('ai');
    setDiscovery(null);
  }, [discovery, path.length, t]);

  const exitDiscoveryToParent = useCallback(() => {
    setDiscovery(null);
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        trackChatbot('chatbot_open', { mode, depth: path.length });
      }
      return !wasOpen;
    });
  }, [mode, path.length]);

  const goBack = useCallback(() => {
    if (discovery) {
      setDiscovery(null);
      return;
    }
    if (path.length > 0) {
      setPath(path.slice(0, -1));
      setFeedbackPending(false);
    }
  }, [discovery, path]);

  const handlePillClick = useCallback(
    (node: TreeNode) => {
      const parentId = path[path.length - 1] ?? 'root';
      const idPath = [...path, node.id];
      // Localized text for what the user sees; analytics keeps node.label
      // (stable English) so events are comparable across locales.
      const label = treeText(idPath, 'label', node.label);

      trackChatbot('chatbot_pill_click', {
        pill_id: node.id,
        pill_label: node.label,
        pill_type: node.type,
        depth: path.length,
        parent_id: parentId,
      });

      if (node.type === 'category') {
        setPath(idPath);
        setFeedbackPending(false);
        return;
      }
      if (node.type === 'answer') {
        lastAnswerRef.current = { id: node.id, parentId };
        setMessages((cur) => [
          ...cur,
          { id: newId(), role: 'user', content: label },
          { id: newId(), role: 'assistant', content: treeText(idPath, 'answer', node.answer) },
        ]);
        setFeedbackPending(true);
        return;
      }
      if (node.type === 'escalate') {
        trackChatbot('chatbot_escalated', {
          reason: 'escalate_node',
          source_id: node.id,
          depth: path.length,
        });
        setMessages((cur) => [
          ...cur,
          { id: newId(), role: 'user', content: label },
          { id: newId(), role: 'assistant', content: treeText(idPath, 'transition', node.transition) },
        ]);
        setMode('ai');
        setFeedbackPending(false);
        return;
      }
      if (node.type === 'product-finder') {
        enterDiscovery(node, label);
        setFeedbackPending(false);
        return;
      }
    },
    [path, enterDiscovery, treeText]
  );

  const sendToAI = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      aiMessageCountRef.current += 1;
      trackChatbot('chatbot_ai_message', {
        message_length: trimmed.length,
        message_index: aiMessageCountRef.current,
      });

      const userMsg: Message = { id: newId(), role: 'user', content: trimmed };
      const assistantId = newId();
      const next = [...messages, userMsg];
      setMessages([...next, { id: assistantId, role: 'assistant', content: '' }]);
      setInput('');
      setStreaming(true);

      // Only send user/assistant messages — the LLM doesn't need the canned answers,
      // but including them gives it context about what the user already saw.
      const apiMessages = next.map((m) => ({ role: m.role, content: m.content }));

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: apiMessages }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => '');
          setMessages((cur) =>
            cur.map((m) =>
              m.id === assistantId
                ? { ...m, content: errText || t('errorGeneric') }
                : m
            )
          );
          return;
        }

        // Parse SSE: events separated by blank lines, each line either
        // `data: <payload>` or `: <comment>` (keepalives). Multi-chunk-safe.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let acc = '';
        let errorMessage: string | null = null;

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sepIndex: number;
          while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex + 2);

            const dataLines: string[] = [];
            for (const line of rawEvent.split('\n')) {
              if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trimStart());
              }
              // Comment lines (`:keepalive`) and other fields are ignored.
            }
            if (dataLines.length === 0) continue;

            let parsed: { type?: string; text?: string; message?: string };
            try {
              parsed = JSON.parse(dataLines.join('\n'));
            } catch {
              continue;
            }

            if (parsed.type === 'delta' && typeof parsed.text === 'string') {
              acc += parsed.text;
              setMessages((cur) =>
                cur.map((m) => (m.id === assistantId ? { ...m, content: acc } : m))
              );
            } else if (parsed.type === 'error') {
              errorMessage = parsed.message ?? t('errorGenericShort');
              break outer;
            } else if (parsed.type === 'done') {
              break outer;
            }
          }
        }

        if (errorMessage) {
          setMessages((cur) =>
            cur.map((m) =>
              m.id === assistantId
                ? { ...m, content: acc ? `${acc}\n\n${errorMessage}` : errorMessage! }
                : m
            )
          );
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setMessages((cur) =>
            cur.map((m) =>
              m.id === assistantId
                ? { ...m, content: t('errorConnection') }
                : m
            )
          );
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming, t]
  );

  const handleSend = useCallback(() => {
    sendToAI(input);
  }, [input, sendToAI]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFeedbackYes = useCallback(() => {
    const ctx = lastAnswerRef.current;
    trackChatbot('chatbot_feedback', {
      helpful: true,
      answer_id: ctx?.id,
      parent_id: ctx?.parentId,
    });
    setMessages((cur) => [
      ...cur,
      { id: newId(), role: 'user', content: t('feedbackYesUser') },
      {
        id: newId(),
        role: 'assistant',
        content: t('feedbackYesAssistant'),
      },
    ]);
    setFeedbackPending(false);
    setPath([]);
    lastAnswerRef.current = null;
  }, [t]);

  const handleFeedbackNo = useCallback(() => {
    const ctx = lastAnswerRef.current;
    trackChatbot('chatbot_feedback', {
      helpful: false,
      answer_id: ctx?.id,
      parent_id: ctx?.parentId,
    });
    trackChatbot('chatbot_escalated', {
      reason: 'unhelpful_answer',
      source_id: ctx?.id,
      depth: path.length,
    });
    setMessages((cur) => [
      ...cur,
      { id: newId(), role: 'user', content: t('feedbackNoUser') },
      {
        id: newId(),
        role: 'assistant',
        content: t('feedbackNoAssistant'),
      },
    ]);
    setMode('ai');
    setFeedbackPending(false);
  }, [path.length, t]);

  // Build the displayed message list (prepend greeting if empty)
  const display = messages.length === 0
    ? [{ id: 'greeting', role: 'assistant' as const, content: t('greeting') }]
    : messages;

  // Determine what pill row to render below the chat
  const showBackButton =
    mode === 'guided' && !feedbackPending && (discovery !== null || path.length > 0);

  return (
    <>
      {/* Toggle button */}
      <button
        type="button"
        onClick={toggleOpen}
        aria-label={open ? t('closeChat') : t('openChat')}
        className="fixed bottom-4 right-4 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary-hover transition-all flex items-center justify-center"
      >
        {open ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label={t('supportChatAria')}
          className="fixed bottom-20 right-4 z-40 w-[calc(100vw-2rem)] sm:w-[26rem] max-h-[calc(100vh-6rem)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <div>
              <div className="font-semibold text-foreground text-sm">{t('headerTitle')}</div>
              <div className="text-xs text-muted-foreground">
                {mode === 'guided' ? t('modeGuided') : t('modeAi')}
              </div>
            </div>
            <button
              type="button"
              onClick={reset}
              aria-label={t('startOver')}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded"
            >
              {t('startOver')}
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
            {display.map((m) => (
              <div
                key={m.id}
                className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[85%] rounded-2xl rounded-br-md bg-primary text-primary-foreground px-3 py-2 whitespace-pre-wrap break-words'
                      : 'max-w-[85%] rounded-2xl rounded-bl-md bg-muted text-foreground px-3 py-2 whitespace-pre-wrap break-words'
                  }
                >
                  {m.role === 'assistant' ? renderContent(m.content) : m.content}
                  {streaming && m.role === 'assistant' && m.id === messages[messages.length - 1]?.id && (
                    <span className="inline-block w-1.5 h-3 ml-0.5 bg-current animate-pulse align-middle" />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Guided controls (pills) */}
          {mode === 'guided' && (
            <div className="border-t border-border bg-background px-3 py-3 max-h-[55%] overflow-y-auto">
              {feedbackPending ? (
                <div>
                  <div className="text-xs text-muted-foreground mb-2 px-1">
                    {t('feedbackQuestion')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleFeedbackYes}
                      className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                    >
                      {t('feedbackYes')}
                    </button>
                    <button
                      type="button"
                      onClick={handleFeedbackNo}
                      className="px-3 py-1.5 rounded-full bg-muted text-foreground text-xs font-medium hover:bg-muted/70 border border-border transition-colors"
                    >
                      {t('feedbackNo')}
                    </button>
                    <ContactUsPill
                      depth={path.length}
                      pathSlug={path.join('/') || 'root'}
                      origin="feedback"
                    />
                  </div>
                </div>
              ) : discovery ? (
                <>
                  {showBackButton && (
                    <button
                      type="button"
                      onClick={goBack}
                      className="text-xs text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      {t('back')}
                    </button>
                  )}

                  {/* Product cards */}
                  <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
                    {discovery.loading
                      ? t('finding', { label: discovery.label.toLowerCase() })
                      : discovery.data && discovery.data.products.length > 0
                        ? t('topPicks', { count: discovery.data.totalMatches })
                        : t('noMatches')}
                  </div>
                  {discovery.data && discovery.data.products.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {discovery.data.products.map((p) => (
                        <Link
                          key={p.id}
                          href={p.url}
                          onClick={() =>
                            trackChatbot('chatbot_product_click', {
                              product_id: p.id,
                              source_id: discovery.nodeId,
                            })
                          }
                          className="group block bg-muted/30 hover:bg-muted/50 border border-border rounded-lg overflow-hidden transition-colors"
                        >
                          <div className="relative aspect-square bg-muted">
                            {p.image ? (
                              <Image
                                src={p.image}
                                alt={p.name}
                                fill
                                sizes="180px"
                                className="object-cover"
                                unoptimized
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                                {t('noImage')}
                              </div>
                            )}
                            {p.onSale && (
                              <span className="absolute top-1 left-1 bg-primary text-primary-foreground text-[10px] font-semibold px-1.5 py-0.5 rounded">
                                {t('sale')}
                              </span>
                            )}
                          </div>
                          <div className="p-2">
                            <div className="text-[11px] font-medium text-foreground line-clamp-2 leading-tight group-hover:text-primary transition-colors">
                              {p.name}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-1 flex items-center justify-between">
                              <span>{p.price != null ? `$${p.price.toFixed(2)}` : '—'}</span>
                              {p.brand && <span className="truncate ml-1 max-w-[60%] text-right">{p.brand}</span>}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}

                  {/* Related guides */}
                  {discovery.data && discovery.data.articles.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
                        {t('relatedGuides')}
                      </div>
                      <div className="space-y-1.5">
                        {discovery.data.articles.map((a) => (
                          <Link
                            key={a.url}
                            href={a.url}
                            onClick={() =>
                              trackChatbot('chatbot_article_click', {
                                article_url: a.url,
                                source_id: discovery.nodeId,
                              })
                            }
                            className="block p-2 rounded-lg bg-muted/30 hover:bg-muted/50 border border-border transition-colors"
                          >
                            <div className="text-xs font-medium text-foreground line-clamp-1">
                              {a.title}
                            </div>
                            {a.excerpt && (
                              <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                                {a.excerpt}
                              </div>
                            )}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Filter pills */}
                  {discovery.data && (
                    <div className="space-y-2 mb-3">
                      {discovery.data.facets.materials.length > 0 && (
                        <FilterRow
                          label={t('filterMaterial')}
                          options={discovery.data.facets.materials.map((m) => ({ id: m.slug, label: m.name }))}
                          activeId={discovery.filters.material}
                          onClick={(id) => applyDiscoveryFilter('material', id)}
                        />
                      )}
                      {discovery.data.facets.colors.length > 0 && (
                        <FilterRow
                          label={t('filterColor')}
                          options={discovery.data.facets.colors.map((c) => ({ id: c.slug, label: c.name }))}
                          activeId={discovery.filters.color}
                          onClick={(id) => applyDiscoveryFilter('color', id)}
                        />
                      )}
                      <FilterRow
                        label={t('filterPrice')}
                        options={discovery.data.facets.priceBands.map((b) => ({ id: b.id, label: b.label }))}
                        activeId={discovery.filters.priceBand}
                        onClick={(id) => applyDiscoveryFilter('priceBand', id)}
                      />
                    </div>
                  )}

                  {/* Ask the assistant */}
                  <button
                    type="button"
                    onClick={exitDiscoveryToAi}
                    className="w-full px-3 py-2 rounded-full bg-primary text-primary-foreground text-xs font-medium hover:bg-primary-hover transition-colors"
                  >
                    {t('askAssistant')}
                  </button>
                </>
              ) : (
                <>
                  {showBackButton && (
                    <button
                      type="button"
                      onClick={goBack}
                      className="text-xs text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      {t('back')}
                    </button>
                  )}
                  <div className="text-xs text-muted-foreground mb-2 px-1">
                    {path.length === 0 ? t('chooseTopic') : t('pickQuestion')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {currentPills.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => handlePillClick(node)}
                        className={
                          node.type === 'escalate'
                            ? 'px-3 py-1.5 rounded-full bg-muted text-foreground text-xs font-medium hover:bg-muted/70 border border-border transition-colors'
                            : 'px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors text-left'
                        }
                      >
                        {treeText([...path, node.id], 'label', node.label)}
                      </button>
                    ))}
                    {/* Always-available escape hatch to /contact, at every level of the tree. */}
                    <ContactUsPill
                      depth={path.length}
                      pathSlug={path.join('/') || 'root'}
                      origin="pill-row"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* AI input */}
          {mode === 'ai' && (
            <div className="border-t border-border p-3 bg-background">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  rows={1}
                  placeholder={t('inputPlaceholder')}
                  className="flex-1 resize-none bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-32"
                  disabled={streaming}
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={streaming || !input.trim()}
                  aria-label={t('sendMessage')}
                  className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-hover transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              </div>
              <div className="text-[10px] text-muted-foreground mt-2 px-1 flex items-center justify-between gap-2">
                <span>{t('aiDisclaimer')} <Link href="/contact" className="underline">{t('contactForm')}</Link>.</span>
                <button
                  type="button"
                  onClick={backToTopics}
                  className="text-muted-foreground hover:text-foreground underline whitespace-nowrap"
                >
                  {t('backToTopics')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Small Link styled like the secondary pills, used as a permanent
 * /contact escape hatch on every guided screen — root pills, every
 * sub-category, and the helpful/unhelpful feedback row. Routes to the
 * contact page so users always have a human path, including when the
 * AI escalation is offline (missing ANTHROPIC_API_KEY).
 */
function ContactUsPill({
  depth,
  pathSlug,
  origin,
}: {
  depth: number;
  pathSlug: string;
  origin: 'pill-row' | 'feedback';
}) {
  const t = useTranslations('chat');
  return (
    <Link
      href="/contact"
      onClick={() =>
        trackChatbot('chatbot_contact_click', {
          depth,
          path: pathSlug,
          origin,
        })
      }
      className="px-3 py-1.5 rounded-full bg-muted text-foreground text-xs font-medium hover:bg-muted/70 border border-border transition-colors inline-flex items-center gap-1"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
      {t('contactUs')}
    </Link>
  );
}

function FilterRow({
  label,
  options,
  activeId,
  onClick,
}: {
  label: string;
  options: { id: string; label: string }[];
  activeId: string | undefined;
  onClick: (id: string) => void;
}) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-1 px-1">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = opt.id === activeId;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onClick(opt.id)}
              className={
                active
                  ? 'px-2.5 py-1 rounded-full bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary-hover transition-colors'
                  : 'px-2.5 py-1 rounded-full bg-muted text-foreground text-[11px] font-medium hover:bg-muted/70 border border-border transition-colors'
              }
            >
              {opt.label}
              {active && <span className="ml-1">×</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
