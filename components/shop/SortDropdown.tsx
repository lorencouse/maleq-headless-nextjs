'use client';

import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';

export type SortOption = 'newest' | 'price-asc' | 'price-desc' | 'name-asc' | 'name-desc' | 'popularity';

interface SortDropdownProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
}

// Sort option config — labelKey indirection so options track the active locale.
const sortOptions: { value: SortOption; labelKey: string }[] = [
  { value: 'newest', labelKey: 'sortNewest' },
  { value: 'popularity', labelKey: 'sortPopularity' },
  { value: 'price-asc', labelKey: 'sortPriceAsc' },
  { value: 'price-desc', labelKey: 'sortPriceDesc' },
  { value: 'name-asc', labelKey: 'sortNameAsc' },
  { value: 'name-desc', labelKey: 'sortNameDesc' },
];

export default function SortDropdown({ value, onChange }: SortDropdownProps) {
  const t = useTranslations('shop');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = sortOptions.find((opt) => opt.value === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2.5 min-h-[44px] border border-input rounded-lg bg-background text-foreground hover:bg-muted transition-colors"
      >
        <span className="text-sm">
          <span className="text-muted-foreground">{t('sortLabel')}</span> {selectedOption && t(selectedOption.labelKey)}
        </span>
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-card border border-border rounded-lg shadow-lg z-20">
          <div className="py-1">
            {sortOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`block w-full text-left px-4 py-3 min-h-[44px] text-sm transition-colors ${
                  value === option.value
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-muted'
                }`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
