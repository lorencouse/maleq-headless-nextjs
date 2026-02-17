/**
 * MySQL connection pool singleton for runtime product queries.
 *
 * Reads connection config from environment variables:
 *   MYSQL_HOST, MYSQL_PORT, MYSQL_DB, MYSQL_USER, MYSQL_PASS
 *
 * Returns null (not configured) when any required var is missing,
 * allowing callers to fall back to GraphQL.
 */
import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';

let pool: Pool | null = null;

export function isMySQLConfigured(): boolean {
  return !!(
    process.env.MYSQL_HOST &&
    process.env.MYSQL_DB &&
    process.env.MYSQL_USER &&
    process.env.MYSQL_PASS
  );
}

export function getPool(): Pool {
  if (pool) return pool;

  if (!isMySQLConfigured()) {
    throw new Error('MySQL is not configured — set MYSQL_HOST, MYSQL_DB, MYSQL_USER, MYSQL_PASS');
  }

  pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
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
