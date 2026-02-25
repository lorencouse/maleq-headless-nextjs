/**
 * Returns the WordPress admin base URL based on which database is active.
 * Checks if a Local by Flywheel socket exists to determine local vs production.
 * Lightweight — no mysql2 dependency, safe to import from any server component.
 */
import { detectLocalMysqlSocket } from './local-runtime';

export function getWpBaseUrl(): string {
  const socket = detectLocalMysqlSocket(process.env.MYSQL_LOCAL_SOCKET);
  if (socket) {
    return process.env.WP_LOCAL_URL || 'http://maleq-local.local';
  }
  return 'https://wp.maleq.com';
}
