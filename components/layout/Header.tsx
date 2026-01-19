'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import ThemeToggle from '@/components/theme/ThemeToggle';
import { useCartItemCount } from '@/lib/store/cart-store';
import { useAuthStore } from '@/lib/store/auth-store';
import MiniCart from '@/components/cart/MiniCart';

export default function Header() {
  const cartItemCount = useCartItemCount();
  const { user, isAuthenticated } = useAuthStore();
  const [isMiniCartOpen, setIsMiniCartOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  return (
    <header className='bg-background border-b border-border shadow-sm transition-colors'>
      <nav className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
        <div className='flex justify-between h-16 items-center'>
          {/* Logo */}
          <div className='flex-shrink-0'>
            <Link href='/' className='text-2xl font-bold'>
              <Image
                src='/images/MQ-logo.png'
                alt='Maleq'
                width={60}
                height={60}
                className='inline-block'
              />
            </Link>
          </div>

          {/* Navigation Links */}
          <div className='hidden md:flex space-x-8'>
            <Link
              href='/shop'
              className='text-foreground hover:text-primary px-3 py-2 text-sm font-medium transition-colors'
            >
              Shop
            </Link>
            <Link
              href='/blog'
              className='text-foreground hover:text-primary px-3 py-2 text-sm font-medium transition-colors'
            >
              Blog
            </Link>
            <Link
              href='/about'
              className='text-foreground hover:text-primary px-3 py-2 text-sm font-medium transition-colors'
            >
              About
            </Link>
            <Link
              href='/contact'
              className='text-foreground hover:text-primary px-3 py-2 text-sm font-medium transition-colors'
            >
              Contact
            </Link>
          </div>

          {/* Cart & User Actions */}
          <div className='flex items-center space-x-2'>
            <ThemeToggle />
            <button className='p-2 text-foreground hover:text-primary transition-colors'>
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
                      <div className='absolute right-0 mt-2 w-48 bg-card border border-border rounded-lg shadow-lg z-50'>
                        <div className='p-3 border-b border-border'>
                          <p className='font-medium text-foreground text-sm'>{user?.displayName}</p>
                          <p className='text-xs text-muted-foreground truncate'>{user?.email}</p>
                        </div>
                        <div className='py-1'>
                          <Link
                            href='/account'
                            onClick={() => setIsUserMenuOpen(false)}
                            className='block px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors'
                          >
                            Dashboard
                          </Link>
                          <Link
                            href='/account/orders'
                            onClick={() => setIsUserMenuOpen(false)}
                            className='block px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors'
                          >
                            Orders
                          </Link>
                          <Link
                            href='/account/details'
                            onClick={() => setIsUserMenuOpen(false)}
                            className='block px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors'
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
                  className='p-2 text-foreground hover:text-primary transition-colors'
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

            <button
              onClick={() => setIsMiniCartOpen(true)}
              className='p-2 text-foreground hover:text-primary relative transition-colors'
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
            <button className='p-2 text-foreground hover:text-primary transition-colors'>
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
        onClose={() => setIsMiniCartOpen(false)}
      />
    </header>
  );
}
