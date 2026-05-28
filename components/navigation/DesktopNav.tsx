'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { mainNavigation, simpleNavLinks, type NavSection } from '@/lib/config/navigation';
import { CategoryIcons } from '@/lib/config/category-icons';

interface DropdownProps {
  section: NavSection;
  isOpen: boolean;
  onClose: () => void;
}

function NavIcon({ iconKey, className = 'w-4 h-4' }: { iconKey?: string; className?: string }) {
  if (!iconKey) return null;
  const icon = CategoryIcons[iconKey as keyof typeof CategoryIcons];
  if (!icon) return null;

  return <span className={className}>{icon}</span>;
}

function MegaMenuDropdown({ section, isOpen, onClose }: DropdownProps) {
  const t = useTranslations('nav');
  const dropdownRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  // Calculate columns based on number of children
  const columns = section.columns || Math.min(section.children.length, 4);

  return (
    <div
      ref={dropdownRef}
      className="absolute top-full left-0 mt-0 pt-2 z-50"
      onMouseLeave={onClose}
    >
      <div className={`bg-card border border-border rounded-lg shadow-xl ${columns === 1 ? 'p-4' : 'p-6'}`}>
        {/* Featured items bar */}
        {section.featured && section.featured.length > 0 && (
          <div className="flex gap-4 pb-4 mb-4 border-b border-border">
            {section.featured.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className="text-sm font-semibold text-primary hover:text-primary transition-colors"
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </div>
        )}

        {/* Main menu grid */}
        <div
          className="grid gap-x-8 gap-y-6"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(160px, 1fr))`,
          }}
        >
          {section.children.map((group) => (
            <div key={group.href} className="min-w-[160px]">
              {/* Group header */}
              <Link
                href={group.href}
                onClick={onClose}
                className="link-animated inline-block mb-3"
              >
                {t(group.labelKey)}
              </Link>

              {/* Group items */}
              {group.children && (
                <ul className="space-y-2">
                  {group.children.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors group"
                      >
                        {item.icon && (
                          <NavIcon
                            iconKey={item.icon}
                            className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0"
                          />
                        )}
                        <span>{t(item.labelKey)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {/* "View All" link */}
              <Link
                href={group.href}
                onClick={onClose}
                className="inline-block text-xs font-medium text-primary hover:text-primary transition-colors mt-3"
              >
                {t('viewAll')} &rarr;
              </Link>
            </div>
          ))}
        </div>

        {/* Shop all link — only shown on the /shop top-level section */}
        {section.href === '/shop' && (
          <div className="mt-6 pt-4 border-t border-border">
            <Link
              href={section.href}
              onClick={onClose}
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary transition-colors"
            >
              {t('shopAll')}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function SimpleDropdown({ section, isOpen, onClose }: DropdownProps) {
  const t = useTranslations('nav');

  if (!isOpen) return null;

  return (
    <div
      className="absolute top-full left-0 mt-0 pt-2 z-50"
      onMouseLeave={onClose}
    >
      <div className="bg-card border border-border rounded-lg shadow-xl p-3 min-w-[220px]">
        {section.children.map((group) => (
          <div key={group.href} className="space-y-1">
            {group.children?.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className="flex flex-col px-3 py-2.5 rounded-md hover:bg-muted hover:text-primary transition-colors"
              >
                <span className="text-sm font-medium text-foreground">{t(item.labelKey)}</span>
                {item.descriptionKey && (
                  <span className="text-xs text-muted-foreground mt-0.5">{t(item.descriptionKey)}</span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DesktopNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  // Open-dropdown state keys on the section labelKey, which is locale-
  // independent (it's the translation key, not the translated value).
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleMouseEnter = (key: string) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setOpenDropdown(key);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setOpenDropdown(null);
    }, 150);
  };

  const handleDropdownMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  };

  const isActive = (href: string) => {
    if (href === '/shop') {
      return pathname === '/shop' || pathname.startsWith('/shop/');
    }
    if (href === '/guides') {
      return pathname === '/guides' || pathname.startsWith('/guides/');
    }
    return pathname === href;
  };

  return (
    <nav className="hidden md:flex items-center space-x-1">
      {/* Main navigation with dropdowns */}
      {mainNavigation.map((section) => (
        <div
          key={section.labelKey}
          className="relative"
          onMouseEnter={() => handleMouseEnter(section.labelKey)}
          onMouseLeave={handleMouseLeave}
        >
          <Link
            href={section.href || '#'}
            className={`flex items-center gap-1 px-3 py-2 text-sm font-medium transition-colors rounded-md ${
              isActive(section.href || '')
                ? 'text-primary'
                : 'text-foreground hover:text-primary hover:bg-muted/50'
            }`}
          >
            {t(section.labelKey)}
            <svg
              className={`w-4 h-4 transition-transform ${openDropdown === section.labelKey ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </Link>

          {/* Dropdown */}
          <div onMouseEnter={handleDropdownMouseEnter}>
            {section.columns && section.columns > 1 ? (
              <MegaMenuDropdown
                section={section}
                isOpen={openDropdown === section.labelKey}
                onClose={() => setOpenDropdown(null)}
              />
            ) : (
              <SimpleDropdown
                section={section}
                isOpen={openDropdown === section.labelKey}
                onClose={() => setOpenDropdown(null)}
              />
            )}
          </div>
        </div>
      ))}

      {/* Simple links without dropdowns */}
      {simpleNavLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`px-3 py-2 text-sm font-medium transition-colors rounded-md ${
            pathname === link.href
              ? 'text-primary'
              : 'text-foreground hover:text-primary hover:bg-muted/50'
          }`}
        >
          {t(link.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
