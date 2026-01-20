'use client';

import Link from 'next/link';

interface PromoCard {
  title: string;
  subtitle: string;
  cta: string;
  href: string;
  bgColor: string;
  textColor?: string;
  icon?: React.ReactNode;
}

const promoCards: PromoCard[] = [
  {
    title: 'Free Shipping',
    subtitle: 'On orders over $79',
    cta: 'Shop Now',
    href: '/shop',
    bgColor: 'bg-gradient-to-br from-primary to-primary-hover',
    textColor: 'text-white',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
    ),
  },
  {
    title: 'Sale Items',
    subtitle: 'Up to 50% off select products',
    cta: 'View Deals',
    href: '/shop?onSale=true',
    bgColor: 'bg-gradient-to-br from-accent to-orange-600',
    textColor: 'text-white',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
      </svg>
    ),
  },
  {
    title: 'Discreet Packaging',
    subtitle: 'Plain packaging on all orders',
    cta: 'Learn More',
    href: '/shipping-returns',
    bgColor: 'bg-gradient-to-br from-secondary to-indigo-700',
    textColor: 'text-white',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
];

export default function ShopHero() {
  return (
    <section className="mb-10">
      {/* Main Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-foreground to-zinc-800 dark:from-zinc-900 dark:to-zinc-800 mb-6">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }} />
        </div>

        <div className="relative px-6 py-12 sm:px-12 sm:py-16 lg:py-20">
          <div className="max-w-2xl">
            <span className="inline-block px-3 py-1 text-xs font-semibold tracking-wider text-primary bg-primary/10 rounded-full mb-4 uppercase">
              Premium Quality
            </span>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 leading-tight">
              Discover Our Collection
            </h1>
            <p className="text-lg text-zinc-300 mb-8 max-w-lg">
              Shop our curated selection of premium products with fast, discreet shipping and satisfaction guaranteed.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/shop?onSale=true"
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary-hover transition-colors"
              >
                Shop Sale
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
              <Link
                href="#categories"
                className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 text-white font-semibold rounded-lg hover:bg-white/20 transition-colors backdrop-blur-sm"
              >
                Browse Categories
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Promo Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {promoCards.map((card, index) => (
          <Link
            key={index}
            href={card.href}
            className={`group relative overflow-hidden rounded-xl ${card.bgColor} p-5 transition-transform hover:scale-[1.02] hover:shadow-lg`}
          >
            <div className="flex items-start justify-between">
              <div className={card.textColor}>
                <div className="mb-3 opacity-90">{card.icon}</div>
                <h3 className="font-bold text-lg mb-1">{card.title}</h3>
                <p className="text-sm opacity-90 mb-3">{card.subtitle}</p>
                <span className="inline-flex items-center gap-1 text-sm font-medium group-hover:gap-2 transition-all">
                  {card.cta}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
