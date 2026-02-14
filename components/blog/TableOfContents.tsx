'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  variant?: 'desktop' | 'mobile';
}

function useTocData() {
  const [headings, setHeadings] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const content = document.querySelector('.entry-content');
    if (!content) return;

    const elements = content.querySelectorAll('h2, h3');
    const items: TocItem[] = [];

    elements.forEach((el, index) => {
      if (!el.id) {
        el.id = `heading-${index}`;
      }
      items.push({
        id: el.id,
        text: el.textContent?.trim() || '',
        level: parseInt(el.tagName[1]),
      });
    });

    setHeadings(items);
  }, []);

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
          <span>Table of Contents</span>
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
      aria-label="Table of contents"
      className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2 scrollbar-thin"
    >
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
        On this page
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
