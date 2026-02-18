/**
 * Returns the WordPress admin base URL based on which database is active.
 * Checks if the Local by Flywheel socket exists to determine local vs production.
 * Lightweight — no mysql2 dependency, safe to import from any server component.
 */
export function getWpBaseUrl(): string {
  const socket = process.env.MYSQL_LOCAL_SOCKET;
  if (socket) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('fs').accessSync(socket);
      return 'http://maleq-local.local';
    } catch {
      // Socket configured but not running
    }
  }
  return 'https://wp.maleq.com';
}
