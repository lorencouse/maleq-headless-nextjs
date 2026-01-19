'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth-store';
import ThemeToggle from '@/components/theme/ThemeToggle';

interface Category {
  id: string;
  name: string;
  slug: string;
  children?: Category[];
}

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  categories?: Category[];
}

export default function MobileMenu({ isOpen, onClose, categories = [] }: MobileMenuProps) {
  const pathname = usePathname();
  const { user, isAuthenticated, logout } = useAuthStore();
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);

  // Close menu on route change
  useEffect(() => {
    onClose();
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

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleLogout = () => {
    logout();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Menu Panel */}
      <div className="fixed inset-y-0 left-0 w-full max-w-sm bg-background z-50 md:hidden overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Menu</h2>
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
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
                href="/login"
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

        {/* Navigation */}
        <nav className="p-4">
          <ul className="space-y-1">
            <li>
              <Link
                href="/shop"
                onClick={onClose}
                className={`block px-4 py-3 rounded-lg transition-colors ${
                  pathname === '/shop'
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-muted'
                }`}
              >
                Shop
              </Link>
            </li>

            {/* Categories */}
            {categories.length > 0 && (
              <li>
                <button
                  onClick={() => toggleCategory('categories')}
                  className="flex items-center justify-between w-full px-4 py-3 text-foreground hover:bg-muted rounded-lg transition-colors"
                >
                  <span>Categories</span>
                  <svg
                    className={`w-5 h-5 text-muted-foreground transition-transform ${
                      expandedCategories.includes('categories') ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {expandedCategories.includes('categories') && (
                  <ul className="mt-1 ml-4 space-y-1 border-l border-border pl-4">
                    {categories.map((category) => (
                      <li key={category.id}>
                        <Link
                          href={`/shop/category/${category.slug}`}
                          onClick={onClose}
                          className={`block px-4 py-2 text-sm rounded-lg transition-colors ${
                            pathname === `/shop/category/${category.slug}`
                              ? 'bg-primary/10 text-primary font-medium'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                          }`}
                        >
                          {category.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )}

            <li>
              <Link
                href="/blog"
                onClick={onClose}
                className={`block px-4 py-3 rounded-lg transition-colors ${
                  pathname === '/blog'
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-muted'
                }`}
              >
                Blog
              </Link>
            </li>

            <li>
              <Link
                href="/about"
                onClick={onClose}
                className={`block px-4 py-3 rounded-lg transition-colors ${
                  pathname === '/about'
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-muted'
                }`}
              >
                About
              </Link>
            </li>

            <li>
              <Link
                href="/contact"
                onClick={onClose}
                className={`block px-4 py-3 rounded-lg transition-colors ${
                  pathname === '/contact'
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-muted'
                }`}
              >
                Contact
              </Link>
            </li>
          </ul>
        </nav>

        {/* Account Links (if logged in) */}
        {isAuthenticated && (
          <div className="p-4 border-t border-border">
            <p className="px-4 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Account
            </p>
            <ul className="space-y-1">
              <li>
                <Link
                  href="/account"
                  onClick={onClose}
                  className="block px-4 py-2 text-sm text-foreground hover:bg-muted rounded-lg transition-colors"
                >
                  Dashboard
                </Link>
              </li>
              <li>
                <Link
                  href="/account/orders"
                  onClick={onClose}
                  className="block px-4 py-2 text-sm text-foreground hover:bg-muted rounded-lg transition-colors"
                >
                  Orders
                </Link>
              </li>
              <li>
                <Link
                  href="/account/addresses"
                  onClick={onClose}
                  className="block px-4 py-2 text-sm text-foreground hover:bg-muted rounded-lg transition-colors"
                >
                  Addresses
                </Link>
              </li>
              <li>
                <button
                  onClick={handleLogout}
                  className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-colors"
                >
                  Sign Out
                </button>
              </li>
            </ul>
          </div>
        )}

        {/* Theme Toggle */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center justify-between px-4">
            <span className="text-sm text-foreground">Dark Mode</span>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </>
  );
}
