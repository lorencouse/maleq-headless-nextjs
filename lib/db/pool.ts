/**
 * MySQL connection pool singleton for runtime product queries.
 *
 * Reads connection config from environment variables:
 *   MYSQL_SOCKET  - Unix socket path (for Local by Flywheel, etc.)
 *   MYSQL_HOST, MYSQL_PORT - TCP connection (for SSH tunnel to production)
 *   MYSQL_DB, MYSQL_USER, MYSQL_PASS - credentials
 *
 * If MYSQL_SOCKET is set, it takes priority over host/port.
 * Returns null (not configured) when required vars are missing,
 * allowing callers to fall back to GraphQL.
 */
import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';

let pool: Pool | null = null;

export function isMySQLConfigured(): boolean {
  return !!(
    (process.env.MYSQL_SOCKET || process.env.MYSQL_HOST) &&
    process.env.MYSQL_DB &&
    process.env.MYSQL_USER &&
    process.env.MYSQL_PASS
  );
}

export function getPool(): Pool {
  if (pool) return pool;

  if (!isMySQLConfigured()) {
    throw new Error('MySQL is not configured — set MYSQL_SOCKET (or MYSQL_HOST), MYSQL_DB, MYSQL_USER, MYSQL_PASS');
  }

  const socketPath = process.env.MYSQL_SOCKET;

  pool = mysql.createPool({
    ...(socketPath
      ? { socketPath }
      : { host: process.env.MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT || '3306', 10) }),
    database: process.env.MYSQL_DB,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    connectionLimit: 10,
    maxIdle: 5,
    idleTimeout: 60_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
  });

  return pool;
}
