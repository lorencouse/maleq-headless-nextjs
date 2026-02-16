# Stage 1: Install dependencies
FROM oven/bun:1-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Stage 2: Build the application
FROM oven/bun:1-alpine AS builder
RUN apk add --no-cache nodejs
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build args for environment variables needed at build time
ARG NEXT_PUBLIC_WORDPRESS_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_GA_ID
ARG NEXT_PUBLIC_IMAGE_BASE_URL

ENV NEXT_PUBLIC_WORDPRESS_API_URL=$NEXT_PUBLIC_WORDPRESS_API_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID
ENV NEXT_PUBLIC_IMAGE_BASE_URL=$NEXT_PUBLIC_IMAGE_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN bun run build

# Stage 3: Production runner (node only, no bun needed)
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy static assets
COPY --from=builder /app/public ./public

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
