'use client';

import Link from 'next/link';
import Image from 'next/image';
import ThemeToggle from '@/components/theme/ThemeToggle';

export default function Header() {
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
            <Link
              href='/cart'
              className='p-2 text-foreground hover:text-primary relative transition-colors'
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
              <span className='absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center'>
                0
              </span>
            </Link>
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
    </header>
  );
}
