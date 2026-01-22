import Link from 'next/link';

interface PromoBannerProps {
  title?: string;
  subtitle?: string;
  discount?: string;
  ctaText?: string;
  ctaLink?: string;
  variant?: 'primary' | 'gradient' | 'dark';
}

export default function PromoBanner({
  title = 'Super Sale',
  subtitle = 'Automatic Discount at Checkout',
  discount,
  ctaText = 'Shop Now',
  ctaLink = '/shop',
  variant = 'gradient',
}: PromoBannerProps) {
  const bgClasses = {
    primary: 'bg-primary',
    gradient: 'bg-gradient-to-r from-primary via-primary-hover to-primary',
    dark: 'bg-zinc-900',
  };

  return (
    <section className={`${bgClasses[variant]} text-white py-6 relative overflow-hidden`}>
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-10">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='0.3' fill-rule='evenodd'%3E%3Cpath d='M0 40L40 0H20L0 20M40 40V20L20 40'/%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Animated sparkles */}
      <div className="absolute top-2 left-[10%] w-2 h-2 bg-white/40 rounded-full animate-pulse" />
      <div className="absolute bottom-3 left-[25%] w-1.5 h-1.5 bg-white/30 rounded-full animate-pulse delay-300" />
      <div className="absolute top-4 right-[15%] w-2 h-2 bg-white/40 rounded-full animate-pulse delay-150" />
      <div className="absolute bottom-2 right-[30%] w-1.5 h-1.5 bg-white/30 rounded-full animate-pulse delay-500" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-center sm:text-left">
            {/* Sale icon */}
            <div className="hidden sm:flex w-12 h-12 bg-white/20 rounded-full items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-xl sm:text-2xl font-bold">{title}</h3>
                {discount && (
                  <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-semibold">
                    {discount}
                  </span>
                )}
              </div>
              <p className="text-white/90 text-sm sm:text-base">{subtitle}</p>
            </div>
          </div>

          <Link
            href={ctaLink}
            className="flex items-center gap-2 bg-white text-primary px-6 py-3 rounded-xl font-semibold hover:bg-white/90 transition-colors whitespace-nowrap"
          >
            {ctaText}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
