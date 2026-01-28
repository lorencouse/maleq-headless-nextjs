'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import ThemeToggle from '@/components/theme/ThemeToggle';
import { useCartItemCount } from '@/lib/store/cart-store';
import { useWishlistItemCount } from '@/lib/store/wishlist-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { useMiniCartOpen, useMiniCartControls } from '@/lib/store/ui-store';
import MiniCart from '@/components/cart/MiniCart';
import SearchAutocomplete from '@/components/search/SearchAutocomplete';
import MobileMenu from '@/components/navigation/MobileMenu';
import DesktopNav from '@/components/navigation/DesktopNav';

export default function Header() {
  const cartItemCount = useCartItemCount();
  const wishlistItemCount = useWishlistItemCount();
  const { user, isAuthenticated } = useAuthStore();
  const isMiniCartOpen = useMiniCartOpen();
  const miniCartControls = useMiniCartControls();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Close search on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSearchOpen(false);
      }
    };

    if (isSearchOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isSearchOpen]);

  return (
    <header className='bg-background border-b border-border shadow-sm transition-colors sticky top-0 z-40' role="banner">
      <nav className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8' aria-label="Main navigation">
        <div className='flex justify-between h-16 items-center'>
          {/* Logo and Navigation */}
          <div className='flex items-center gap-6'>
            <div className='flex-shrink-0'>
              <Link href='/' className='text-2xl font-bold'>
                <Image
                  src='/images/MQ-logo.png'
                  alt='Male Q'
                  width={60}
                  height={60}
                  className='inline-block'
                />
              </Link>
            </div>

            {/* Navigation Links */}
            <DesktopNav />
          </div>

          {/* Cart & User Actions */}
          <div className='flex items-center space-x-1'>
            <ThemeToggle />
            <button
              onClick={() => setIsSearchOpen(true)}
              className='p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-foreground hover:text-primary transition-colors'
              aria-label='Search'
            >
              <svg
                className='h-5 w-5'
                fill='none'
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth='2'
                viewBox='0 0 24 24'
                stroke='currentColor'
              >
                <path d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'></path>
              </svg>
            </button>

            {/* User Account */}
            <div className='relative'>
              {isAuthenticated ? (
                <>
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className='p-2 text-foreground hover:text-primary transition-colors flex items-center gap-1'
                    aria-label='User menu'
                  >
                    <div className='w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center'>
                      <span className='text-xs font-semibold text-primary'>
                        {user?.firstName?.charAt(0) || 'U'}
                      </span>
                    </div>
                  </button>
                  {isUserMenuOpen && (
                    <>
                      <div
                        className='fixed inset-0 z-40'
                        onClick={() => setIsUserMenuOpen(false)}
                      />
                      <div className='absolute right-0 mt-2 w-48 max-w-[calc(100vw-2rem)] bg-card border border-border rounded-lg shadow-lg z-50'>
                        <div className='p-3 border-b border-border'>
                          <p className='font-medium text-foreground text-sm'>{user?.displayName}</p>
                          <p className='text-xs text-muted-foreground truncate'>{user?.email}</p>
                        </div>
                        <div className='py-1'>
                          <Link
                            href='/account'
                            onClick={() => setIsUserMenuOpen(false)}
                            className='block px-4 py-3 min-h-[44px] text-sm text-foreground hover:bg-muted transition-colors'
                          >
                            Dashboard
                          </Link>
                          <Link
                            href='/account/orders'
                            onClick={() => setIsUserMenuOpen(false)}
                            className='block px-4 py-3 min-h-[44px] text-sm text-foreground hover:bg-muted transition-colors'
                          >
                            Orders
                          </Link>
                          <Link
                            href='/account/details'
                            onClick={() => setIsUserMenuOpen(false)}
                            className='block px-4 py-3 min-h-[44px] text-sm text-foreground hover:bg-muted transition-colors'
                          >
                            Account Details
                          </Link>
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <Link
                  href='/login'
                  className='p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-foreground hover:text-primary transition-colors'
                  aria-label='Sign in'
                >
                  <svg
                    className='h-5 w-5'
                    fill='none'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth='2'
                    viewBox='0 0 24 24'
                    stroke='currentColor'
                  >
                    <path d='M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'></path>
                  </svg>
                </Link>
              )}
            </div>

            {/* Wishlist */}
            <Link
              href='/account/wishlist'
              className='p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-foreground hover:text-primary relative transition-colors'
              aria-label='View wishlist'
            >
              <svg
                className='h-5 w-5'
                fill='none'
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth='2'
                viewBox='0 0 24 24'
                stroke='currentColor'
              >
                <path d='M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z'></path>
              </svg>
              {wishlistItemCount > 0 && (
                <span className='absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs font-semibold rounded-full h-5 w-5 flex items-center justify-center'>
                  {wishlistItemCount}
                </span>
              )}
            </Link>

            <button
              onClick={miniCartControls.open}
              className='p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-foreground hover:text-primary relative transition-colors'
              aria-label='Open shopping cart'
            >
              <svg
                className='h-5 w-5'
                fill='none'
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth='2'
                viewBox='0 0 24 24'
                stroke='currentColor'
              >
                <path d='M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z'></path>
              </svg>
              {cartItemCount > 0 && (
                <span className='absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs font-semibold rounded-full h-5 w-5 flex items-center justify-center'>
                  {cartItemCount}
                </span>
              )}
            </button>
          </div>

          {/* Mobile menu button */}
          <div className='md:hidden'>
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className='p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-foreground hover:text-primary transition-colors'
              aria-label='Open menu'
            >
              <svg
                className='h-5 w-5'
                fill='none'
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth='2'
                viewBox='0 0 24 24'
                stroke='currentColor'
              >
                <path d='M4 6h16M4 12h16M4 18h16'></path>
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* Mini Cart */}
      <MiniCart
        isOpen={isMiniCartOpen}
        onClose={miniCartControls.close}
      />

      {/* Search Modal */}
      {isSearchOpen && (
        <>
          <div
            className='fixed inset-0 bg-black/50 z-50'
            onClick={() => setIsSearchOpen(false)}
          />
          <div className='fixed top-0 left-0 right-0 z-50 p-4 pt-20'>
            <div className='max-w-2xl mx-auto'>
              <SearchAutocomplete
                autoFocus
                onClose={() => setIsSearchOpen(false)}
              />
            </div>
          </div>
        </>
      )}

      {/* Mobile Menu */}
      <MobileMenu
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
      />
    </header>
  );
}
