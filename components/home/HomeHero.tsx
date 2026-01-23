import Link from 'next/link';

export default function HomeHero() {
  return (
    <section className='relative bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 text-white overflow-hidden'>
      {/* Background pattern */}
      <div className='absolute inset-0 opacity-5'>
        <div
          className='absolute inset-0'
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Gradient overlays */}
      <div className='absolute top-0 left-0 w-96 h-96 bg-primary/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2' />
      <div className='absolute bottom-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2' />

      <div className='relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28'>
        <div className='max-w-3xl'>
          {/* Badge */}
          <div className='inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-sm mb-6'>
            <span className='w-2 h-2 bg-green-400 rounded-full animate-pulse' />
            <span>Discreet Shipping on All Orders</span>
          </div>

          {/* Brand */}
          <h1 className='mb-2'>
            <span className='text-primary font-bold text-5xl sm:text-6xl tracking-wide'>
              Male Q
            </span>
          </h1>

          {/* Heading */}
          <h2 className='text-2xl sm:text-3xl lg:text-4xl font-bold mb-6 leading-tight'>
            Men&apos;s Questions,{' '}
            <span className='text-primary'>Answered.</span>
          </h2>

          {/* Subheading */}
          <p className='text-lg sm:text-xl text-zinc-300 mb-8 max-w-2xl'>
            Empowering men everywhere with expert guides, quality products, and
            the knowledge to lead happier, healthier lives.
          </p>

          {/* CTAs */}
          <div className='flex flex-col sm:flex-row gap-4'>
            <Link
              href='/shop'
              className='inline-flex items-center justify-center gap-2 bg-primary text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-primary-hover transition-colors'
            >
              Shop Now
              <svg
                className='w-5 h-5'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M17 8l4 4m0 0l-4 4m4-4H3'
                />
              </svg>
            </Link>
            <Link
              href='/blog'
              className='inline-flex items-center justify-center gap-2 bg-white/10 backdrop-blur-sm text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-white/20 transition-colors border border-white/20'
            >
              Explore Guides
            </Link>
          </div>

          {/* Trust indicators */}
          <div className='flex flex-wrap gap-6 mt-10 pt-10 border-t border-white/10'>
            <div className='flex items-center gap-2 text-sm text-zinc-300'>
              <svg
                className='w-5 h-5 text-primary'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z'
                />
              </svg>
              <span>Secure Checkout</span>
            </div>
            <div className='flex items-center gap-2 text-sm text-zinc-300'>
              <svg
                className='w-5 h-5 text-primary'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z'
                />
              </svg>
              <span>Plain Packaging</span>
            </div>
            <div className='flex items-center gap-2 text-sm text-zinc-300'>
              <svg
                className='w-5 h-5 text-primary'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12'
                />
              </svg>
              <span>Fast Shipping</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
