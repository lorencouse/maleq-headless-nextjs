# Claude Code Instructions for Male Q Headless

## Build & Testing Rules

- **NEVER run `bun run build` or `npm run build` unless explicitly requested** - builds can crash/hang the project
- Use TypeScript type checking (`npx tsc --noEmit --skipLibCheck`) for validation instead
- Run individual file compilation checks when needed

## Project Context

- Next.js 15 headless WooCommerce e-commerce site
- Uses Bun as package manager
- Main branch: `initial-setup`
- WordPress backend with WPGraphQL

## Key Directories

- `app/` - Next.js App Router pages
- `components/` - React components
- `lib/` - Utilities, services, GraphQL queries
- `scripts/` - CLI scripts (price updates, migrations)
- `wordpress/mu-plugins/` - WordPress must-use plugins
- `docs/` - Documentation

## Local WordPress Installation

- **Location**: `~/Local Sites/maleq-local/app/public/`
- **URL**: `http://maleq-local.local`
- **mu-plugins**: `~/Local Sites/maleq-local/app/public/wp-content/mu-plugins/`
- **Platform**: Local by Flywheel

## API Preferences

- **Always prefer WPGraphQL over WooCommerce REST API** - GraphQL is more reliable and doesn't have the same authentication issues as the REST API
- For authenticated operations not available via GraphQL, use custom REST endpoints in `wordpress/mu-plugins/` that return data directly
