'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth-store';
import { useWishlistItemCount } from '@/lib/store/wishlist-store';
import ThemeToggle from '@/components/theme/ThemeToggle';
import { mainNavigation, simpleNavLinks, accountNavigation } from '@/lib/config/navigation';
import { CategoryIcons } from '@/lib/config/category-icons';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

function NavIcon({ iconKey, className = 'w-4 h-4' }: { iconKey?: string; className?: string }) {
  if (!iconKey) return null;
  const icon = CategoryIcons[iconKey as keyof typeof CategoryIcons];
  if (!icon) return null;

  return <span className={className}>{icon}</span>;
}

export default function MobileMenu({ isOpen, onClose }: MobileMenuProps) {
  const pathname = usePathname();
  const { user, isAuthenticated, logout } = useAuthStore();
  const wishlistItemCount = useWishlistItemCount();
  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const prevPathname = useRef(pathname);

  // Close menu on route change (but not on initial mount)
  useEffect(() => {
    if (prevPathname.current !== pathname) {
      onClose();
      prevPathname.current = pathname;
    }
  }, [pathname, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const toggleSection = (label: string) => {
    setExpandedSections((prev) =>
      prev.includes(label) ? prev.filter((s) => s !== label) : [...prev, label]
    );
  };

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) =>
      prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label]
    );
  };

  const handleLogout = () => {
    logout();
    onClose();
  };

  const isActive = (href: string) => pathname === href;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Menu Panel */}
      <div
        className={`fixed inset-y-0 left-0 w-full max-w-sm bg-background z-50 md:hidden overflow-y-auto transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Menu</h2>
          <button
            onClick={onClose}
            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            aria-label="Close menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* User Section */}
        <div className="p-4 border-b border-border">
          {isAuthenticated ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-sm font-semibold text-primary">
                  {user?.firstName?.charAt(0) || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{user?.displayName}</p>
                <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <Link
                href={pathname.startsWith('/login') || pathname.startsWith('/register') || pathname.startsWith('/forgot-password') ? '/login' : `/login?returnTo=${encodeURIComponent(pathname)}`}
                onClick={onClose}
                className="flex-1 py-2.5 text-center border border-input rounded-lg text-foreground hover:bg-muted transition-colors font-medium"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                onClick={onClose}
                className="flex-1 py-2.5 text-center bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-medium"
              >
                Register
              </Link>
            </div>
          )}
        </div>

        {/* Main Navigation */}
        <nav className="p-4">
          <ul className="space-y-1">
            {/* Main navigation sections */}
            {mainNavigation.map((section) => (
              <li key={section.label}>
                {/* Section header */}
                <button
                  onClick={() => toggleSection(section.label)}
                  className={`flex items-center justify-between w-full px-4 py-3 rounded-lg transition-colors ${
                    isActive(section.href || '')
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  <span className="font-medium">{section.label}</span>
                  <svg
                    className={`w-5 h-5 text-muted-foreground transition-transform ${
                      expandedSections.includes(section.label) ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Section content */}
                {expandedSections.includes(section.label) && (
                  <div className="mt-1 ml-4 border-l border-border pl-4 space-y-1">
                    {/* Featured links */}
                    {section.featured && section.featured.length > 0 && (
                      <div className="pb-2 mb-2 border-b border-border">
                        {section.featured.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={onClose}
                            className="block px-4 py-3 text-sm font-semibold text-primary hover:bg-muted rounded-lg transition-colors"
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    )}

                    {/* Groups */}
                    {section.children.map((group) => (
                      <div key={group.label}>
                        <button
                          onClick={() => toggleGroup(`${section.label}-${group.label}`)}
                          className="flex items-center justify-between w-full px-4 py-3 text-sm text-foreground hover:bg-muted rounded-lg transition-colors"
                        >
                          <span>{group.label}</span>
                          {group.children && group.children.length > 0 && (
                            <svg
                              className={`w-4 h-4 text-muted-foreground transition-transform ${
                                expandedGroups.includes(`${section.label}-${group.label}`) ? 'rotate-180' : ''
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </button>

                        {/* Group items */}
                        {group.children && expandedGroups.includes(`${section.label}-${group.label}`) && (
                          <ul className="ml-4 mt-1 space-y-0.5">
                            {group.children.map((item) => (
                              <li key={item.href}>
                                <Link
                                  href={item.href}
                                  onClick={onClose}
                                  className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-lg transition-colors min-h-[44px] ${
                                    isActive(item.href)
                                      ? 'bg-primary/10 text-primary'
                                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                  }`}
                                >
                                  {item.icon && (
                                    <NavIcon iconKey={item.icon} className="w-4 h-4" />
                                  )}
                                  <span>{item.label}</span>
                                </Link>
                              </li>
                            ))}
                            {/* View all link */}
                            <li>
                              <Link
                                href={group.href}
                                onClick={onClose}
                                className="block px-4 py-2.5 min-h-[44px] text-xs font-medium text-primary hover:bg-muted rounded-lg transition-colors flex items-center"
                              >
                                View All &rarr;
                              </Link>
                            </li>
                          </ul>
                        )}
                      </div>
                    ))}

                    {/* Section "View All" link */}
                    {section.href && (
                      <Link
                        href={section.href}
                        onClick={onClose}
                        className="block px-4 py-2.5 min-h-[44px] text-sm font-medium text-primary hover:bg-muted rounded-lg transition-colors mt-2 flex items-center"
                      >
                        View All {section.label} &rarr;
                      </Link>
                    )}
                  </div>
                )}
              </li>
            ))}

            {/* Simple links */}
            {simpleNavLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={onClose}
                  className={`block px-4 py-3 rounded-lg transition-colors ${
                    isActive(link.href)
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Account Links (if logged in) */}
        {isAuthenticated && (
          <div className="p-4 border-t border-border">
            <p className="px-4 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Account
            </p>
            <ul className="space-y-1">
              {accountNavigation.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={onClose}
                    className="block px-4 py-3 text-sm text-foreground hover:bg-muted rounded-lg transition-colors min-h-[44px]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <button
                  onClick={handleLogout}
                  className="block w-full text-left px-4 py-3 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors min-h-[44px]"
                >
                  Sign Out
                </button>
              </li>
            </ul>
          </div>
        )}

        {/* Quick Actions */}
        <div className="p-4 border-t border-border">
          <p className="px-4 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Quick Actions
          </p>
          <ul className="space-y-1">
            <li>
              <Link
                href="/account/wishlist"
                onClick={onClose}
                className="flex items-center justify-between px-4 py-3 text-sm text-foreground hover:bg-muted rounded-lg transition-colors min-h-[44px]"
              >
                <span className="flex items-center gap-3">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                  Wishlist
                </span>
                {wishlistItemCount > 0 && (
                  <span className="bg-primary text-primary-foreground text-xs font-semibold rounded-full h-5 min-w-[20px] px-1.5 flex items-center justify-center">
                    {wishlistItemCount}
                  </span>
                )}
              </Link>
            </li>
          </ul>
        </div>

        {/* Theme Toggle */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-sm text-foreground">Dark Mode</span>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </>
  );
}
