/** @type {import('@lhci/cli').Config} */
module.exports = {
  ci: {
    collect: {
      // Use static server mode — builds the app then serves it
      startServerCommand: 'bun run start',
      startServerReadyPattern: 'Ready in',
      startServerReadyTimeout: 30000,
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/shop',
      ],
      numberOfRuns: 3,
      settings: {
        // Only run PWA and performance audits (skip full a11y/SEO for speed)
        onlyCategories: ['performance', 'pwa'],
        // Throttle to simulate mobile
        preset: 'desktop',
      },
    },
    assert: {
      assertions: {
        // PWA must score at least 90
        'categories:pwa': ['error', { minScore: 0.9 }],
        // Performance must score at least 70 (lower threshold since local build)
        'categories:performance': ['warn', { minScore: 0.7 }],
        // Key PWA checks
        'installable-manifest': 'error',
        'service-worker': 'error',
        'themed-omnibox': 'warn',
        'maskable-icon': 'warn',
      },
    },
    upload: {
      // Use temporary public storage (no server needed)
      target: 'temporary-public-storage',
    },
  },
};
