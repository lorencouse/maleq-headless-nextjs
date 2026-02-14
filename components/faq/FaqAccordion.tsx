'use client';

import { useState } from 'react';

interface FaqItem {
  question: string;
  answer: string | React.ReactNode;
}

interface FaqAccordionProps {
  items: FaqItem[];
  allowMultiple?: boolean;
}

export default function FaqAccordion({ items, allowMultiple = false }: FaqAccordionProps) {
  const [openItems, setOpenItems] = useState<Set<number>>(new Set());

  const toggleItem = (index: number) => {
    setOpenItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        if (!allowMultiple) {
          newSet.clear();
        }
        newSet.add(index);
      }
      return newSet;
    });
  };

  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div
          key={index}
          className="border border-border rounded-xl overflow-hidden bg-card shadow-sm"
        >
          <button
            onClick={() => toggleItem(index)}
            className="w-full px-6 py-5 flex items-center justify-between text-left bg-card hover:bg-input/50 transition-colors"
            aria-expanded={openItems.has(index)}
          >
            <span className="font-semibold text-foreground pr-4 text-base">{item.question}</span>
            <span className={`flex items-center justify-center w-8 h-8 rounded-full bg-input transition-all duration-200 ${
              openItems.has(index) ? 'bg-primary' : ''
            }`}>
              <svg
                className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${
                  openItems.has(index) ? 'rotate-180 text-primary-foreground' : 'text-foreground'
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </button>
          <div
            className={`overflow-hidden transition-all duration-300 ease-in-out ${
              openItems.has(index) ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'
            }`}
          >
            <div className="px-6 py-5 text-foreground/80 leading-relaxed border-t border-border bg-input/30">
              {item.answer}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
