# Maleq Headless E-commerce Store

A modern, high-performance e-commerce storefront built with Next.js 16, headless WordPress/WooCommerce, and Stripe.

## Features

- **Headless Architecture**: Next.js frontend with WordPress/WooCommerce backend
- **Full E-commerce**: Product browsing, cart, checkout, user accounts
- **Payment Processing**: Stripe integration with test and live modes
- **User Authentication**: Registration, login, password reset
- **Product Discovery**: Search, filters, categories, sorting
- **Wishlist & Reviews**: Save favorites, read and write reviews
- **SEO Optimized**: Sitemap, structured data, meta tags
- **Accessible**: WCAG 2.1 AA compliant, keyboard navigation
- **Responsive**: Mobile-first design, works on all devices
- **Performance**: Image optimization, caching, code splitting

## Tech Stack

- **Frontend**: Next.js 16, React 18, TypeScript
- **Styling**: Tailwind CSS 4
- **State Management**: Zustand
- **Data Fetching**: Apollo Client (GraphQL), WooCommerce REST API
- **Payment**: Stripe
- **Testing**: Jest, Playwright
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+ or Bun 1.0+
- WordPress with WooCommerce and WPGraphQL plugins
- Stripe account

### Installation

1. **Clone the repository**

```bash
git clone https://github.com/your-org/maleq-headless.git
cd maleq-headless
```

2. **Install dependencies**

```bash
bun install
```

3. **Set up environment variables**

Copy the example environment file:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your values:

```env
# WordPress GraphQL API
NEXT_PUBLIC_WORDPRESS_API_URL=https://your-wp-site.com/graphql

# Site URL
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# WooCommerce REST API
WOOCOMMERCE_URL=https://your-wp-site.com
WOOCOMMERCE_CONSUMER_KEY=ck_xxxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxx

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
STRIPE_SECRET_KEY=sk_test_xxxxx

# Optional: Analytics
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
```

4. **Run the development server**

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
maleq-headless/
├── app/                    # Next.js App Router pages
│   ├── (routes)/          # Page routes
│   ├── api/               # API routes
│   ├── layout.tsx         # Root layout
│   └── globals.css        # Global styles
├── components/            # React components
│   ├── account/           # Account pages
│   ├── cart/              # Cart components
│   ├── checkout/          # Checkout flow
│   ├── layout/            # Header, Footer
│   ├── product/           # Product display
│   ├── reviews/           # Review system
│   ├── search/            # Search autocomplete
│   ├── shop/              # Shop page, filters
│   └── ui/                # Shared UI components
├── lib/                   # Utilities and services
│   ├── analytics/         # GA4 tracking
│   ├── apollo/            # GraphQL client
│   ├── monitoring/        # Error tracking
│   ├── queries/           # GraphQL queries
│   ├── store/             # Zustand stores
│   ├── stripe/            # Stripe integration
│   ├── utils/             # Helper functions
│   └── woocommerce/       # WooCommerce client
├── docs/                  # Documentation
├── __tests__/             # Unit tests
├── e2e/                   # E2E tests
└── public/                # Static assets
```

## Available Scripts

```bash
# Development
bun run dev          # Start dev server with Turbopack

# Build
bun run build        # Production build
bun run start        # Start production server

# Testing
bun run test         # Run unit tests
bun run test:watch   # Run tests in watch mode
bun run test:coverage # Run tests with coverage
bun run test:e2e     # Run E2E tests
bun run test:e2e:ui  # Run E2E tests with UI

# Linting
bun run lint         # Run ESLint

# Data Import
bun run import       # Import products from Williams Trading
bun run import:test  # Import limited products for testing
```

## Configuration

### WordPress Requirements

Your WordPress installation needs:

1. **WPGraphQL** plugin - Exposes GraphQL API
2. **WooCommerce** - E-commerce functionality
3. **WPGraphQL for WooCommerce** - WooCommerce GraphQL support

### WooCommerce API Setup

1. Go to WooCommerce > Settings > Advanced > REST API
2. Create a new API key with Read/Write permissions
3. Copy the Consumer Key and Secret to `.env.local`

### Stripe Setup

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Get API keys from Dashboard > Developers > API Keys
3. Use test keys for development, live keys for production

## Testing

### Unit Tests

```bash
bun run test
```

Tests are located in `__tests__/` and use Jest with React Testing Library.

### E2E Tests

```bash
bun run test:e2e
```

E2E tests are located in `e2e/` and use Playwright.

## Deployment

### Vercel (Recommended)

1. Connect your GitHub repository to Vercel
2. Configure environment variables in Vercel dashboard
3. Deploy automatically on push

See [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) for detailed instructions.

### Manual Deployment

```bash
bun run build
bun run start
```

## Documentation

- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) - Feature roadmap
- [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) - Deployment instructions
- [Security Audit](docs/SECURITY_AUDIT.md) - Security review
- [UAT Test Plan](docs/UAT_TEST_PLAN.md) - Testing checklist
- [API Documentation](docs/API_DOCUMENTATION.md) - API endpoints

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is proprietary. All rights reserved.

## Support

For support, please contact [support@maleq.com](mailto:support@maleq.com).
