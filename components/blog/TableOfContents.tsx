'use client';

import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  variant?: 'desktop' | 'mobile';
}

// Stable empty reference for the server/initial snapshot. useSyncExternalStore
// requires getServerSnapshot to return a CACHED value — a fresh `[]` each call
// makes production React treat hydration as failed (#418) and bail the subtree.
// On the guide page that bail also strands sibling client components (e.g. the
// add-to-cart enhancer), so keep this reference stable.
const EMPTY_HEADINGS: TocItem[] = [];

function getServerHeadingsSnapshot(): TocItem[] {
  return EMPTY_HEADINGS;
}

let headingsSnapshotCache: {
  key: string;
  items: TocItem[];
} = {
  key: '',
  items: EMPTY_HEADINGS,
};

function getHeadingsFromDocument(): TocItem[] {
  if (typeof document === 'undefined') {
    return [];
  }

  const content = document.querySelector('.entry-content');
  if (!content) return [];

  const elements = content.querySelectorAll('h2, h3');
  const items: TocItem[] = [];

  elements.forEach((el, index) => {
    if (!el.id) {
      el.id = `heading-${index}`;
    }
    items.push({
      id: el.id,
      text: el.textContent?.trim() || '',
      level: parseInt(el.tagName[1], 10),
    });
  });

  const key = items.map(({ id, text, level }) => `${id}:${level}:${text}`).join('|');
  if (key === headingsSnapshotCache.key) {
    return headingsSnapshotCache.items;
  }

  headingsSnapshotCache = {
    key,
    items,
  };

  return items;
}

function subscribeToHeadings(onStoreChange: () => void) {
  if (typeof document === 'undefined') {
    return () => {};
  }

  const observer = new MutationObserver(() => {
    onStoreChange();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  queueMicrotask(onStoreChange);

  return () => observer.disconnect();
}

function useTocData() {
  const headings = useSyncExternalStore(
    subscribeToHeadings,
    getHeadingsFromDocument,
    getServerHeadingsSnapshot
  );
  const [activeId, setActiveId] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  const handleIntersect = useCallback((entries: IntersectionObserverEntry[]) => {
    const visibleEntries = entries.filter(e => e.isIntersecting);
    if (visibleEntries.length > 0) {
      const sorted = visibleEntries.sort(
        (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
      );
      setActiveId(sorted[0].target.id);
    }
  }, []);

  useEffect(() => {
    if (headings.length === 0) return;

    observerRef.current = new IntersectionObserver(handleIntersect, {
      rootMargin: '-80px 0px -60% 0px',
    });

    headings.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observerRef.current!.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, [headings, handleIntersect]);

  return { headings, activeId, setActiveId };
}

export default function TableOfContents({ variant = 'desktop' }: TableOfContentsProps) {
  const t = useTranslations('blog');
  const { headings, activeId, setActiveId } = useTocData();
  const [isOpen, setIsOpen] = useState(false);

  if (headings.length < 3) return null;

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
      setIsOpen(false);
    }
  };

  if (variant === 'mobile') {
    return (
      <div className="xl:hidden mb-6">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-between w-full px-4 py-3 bg-card border border-border rounded-lg text-sm font-medium text-foreground"
        >
          <span>{t('tocMobileLabel')}</span>
          <svg
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && (
          <ul className="mt-2 px-4 py-3 bg-card border border-border rounded-lg space-y-1">
            {headings.map(({ id, text, level }) => (
              <li key={id}>
                <button
                  onClick={() => scrollTo(id)}
                  className={`block w-full text-left text-sm py-1.5 text-muted-foreground hover:text-foreground transition-colors ${
                    level === 3 ? 'pl-4' : ''
                  } ${activeId === id ? 'text-primary font-medium' : ''}`}
                >
                  {text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <nav
      aria-label={t('tocAria')}
      className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2 scrollbar-thin"
    >
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
        {t('tocDesktopHeading')}
      </h2>
      <ul className="space-y-1 border-l-2 border-border">
        {headings.map(({ id, text, level }) => (
          <li key={id}>
            <button
              onClick={() => scrollTo(id)}
              className={`block w-full text-left text-sm py-1 transition-colors border-l-2 -ml-[2px] ${
                level === 3 ? 'pl-6' : 'pl-3'
              } ${
                activeId === id
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
