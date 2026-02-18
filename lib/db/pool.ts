/**
 * MySQL connection pool singleton for runtime product queries.
 *
 * Supports automatic fallback: tries local socket first (Local by Flywheel),
 * and if that's not available, falls back to production via SSH tunnel.
 *
 * Environment variables (dual-config):
 *   Local:  MYSQL_LOCAL_SOCKET, MYSQL_LOCAL_DB, MYSQL_LOCAL_USER, MYSQL_LOCAL_PASS
 *   Prod:   MYSQL_PROD_HOST, MYSQL_PROD_PORT, MYSQL_PROD_DB, MYSQL_PROD_USER, MYSQL_PROD_PASS
 *
 * Legacy single-config also supported:
 *   MYSQL_SOCKET / MYSQL_HOST, MYSQL_PORT, MYSQL_DB, MYSQL_USER, MYSQL_PASS
 */
import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';

let pool: Pool | null = null;
let activeMode: 'local' | 'prod' | 'legacy' | null = null;

interface DBConfig {
  mode: 'local' | 'prod' | 'legacy';
  socketPath?: string;
  host?: string;
  port?: number;
  database: string;
  user: string;
  password: string;
}

let localConfigCache: DBConfig | null | undefined;

function getLocalConfig(): DBConfig | null {
  if (localConfigCache !== undefined) return localConfigCache;

  const socket = process.env.MYSQL_LOCAL_SOCKET;
  const db = process.env.MYSQL_LOCAL_DB;
  const user = process.env.MYSQL_LOCAL_USER;
  const pass = process.env.MYSQL_LOCAL_PASS;
  if (!socket || !db || !user || !pass) {
    localConfigCache = null;
    return null;
  }
  // Only use local if the socket file actually exists (i.e. Local by Flywheel is running)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('fs').accessSync(socket);
  } catch {
    localConfigCache = null;
    return null;
  }
  localConfigCache = { mode: 'local', socketPath: socket, database: db, user, password: pass };
  return localConfigCache;
}

function getProdConfig(): DBConfig | null {
  const host = process.env.MYSQL_PROD_HOST;
  const db = process.env.MYSQL_PROD_DB;
  const user = process.env.MYSQL_PROD_USER;
  const pass = process.env.MYSQL_PROD_PASS;
  if (!host || !db || !user || !pass) return null;
  return {
    mode: 'prod',
    host,
    port: parseInt(process.env.MYSQL_PROD_PORT || '3306', 10),
    database: db,
    user,
    password: pass,
  };
}

/** Legacy single-config (backwards compatible) */
function getLegacyConfig(): DBConfig | null {
  const db = process.env.MYSQL_DB;
  const user = process.env.MYSQL_USER;
  const pass = process.env.MYSQL_PASS;
  if (!db || !user || !pass) return null;

  const socket = process.env.MYSQL_SOCKET;
  if (socket) {
    return { mode: 'legacy', socketPath: socket, database: db, user, password: pass };
  }
  const host = process.env.MYSQL_HOST;
  if (host) {
    return {
      mode: 'legacy',
      host,
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      database: db,
      user,
      password: pass,
    };
  }
  return null;
}

export function isMySQLConfigured(): boolean {
  return !!(getLocalConfig() || getProdConfig() || getLegacyConfig());
}

/**
 * Check if MySQL is configured AND reachable.
 * Caches the result for 60s so we don't spam connection attempts.
 */
let reachableResult: boolean | null = null;
let reachableCheckedAt = 0;
const REACHABLE_TTL = 60_000;

export async function isMySQLReachable(): Promise<boolean> {
  if (!isMySQLConfigured()) return false;

  const now = Date.now();
  if (reachableResult !== null && now - reachableCheckedAt < REACHABLE_TTL) {
    return reachableResult;
  }

  try {
    const p = getPool();
    const conn = await p.getConnection();
    conn.release();
    reachableResult = true;
  } catch {
    reachableResult = false;
  }
  reachableCheckedAt = now;
  return reachableResult;
}

export function getPool(): Pool {
  if (pool) return pool;

  // Priority: local socket (if file exists) → production (SSH tunnel) → legacy
  const config = getLocalConfig() || getProdConfig() || getLegacyConfig();

  if (!config) {
    throw new Error(
      'MySQL is not configured — set MYSQL_LOCAL_* or MYSQL_PROD_* (or legacy MYSQL_*) env vars',
    );
  }

  const isRemote = !config.socketPath;

  pool = mysql.createPool({
    ...(config.socketPath
      ? { socketPath: config.socketPath }
      : { host: config.host, port: config.port }),
    database: config.database,
    user: config.user,
    password: config.password,
    // Remote (SSH tunnel) connections are less reliable — keep fewer idle and recycle faster
    connectionLimit: isRemote ? 5 : 10,
    maxIdle: isRemote ? 1 : 5,
    idleTimeout: isRemote ? 10_000 : 60_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: isRemote ? 5_000 : 10_000,
  });

  activeMode = config.mode;
  if (config.mode === 'local') {
    console.log('\n🟢 Using Local DB (Local by Flywheel)\n');
  } else if (config.mode === 'prod') {
    console.log('\n🟠 Using Production DB (wp.maleq.com via SSH tunnel)\n');
  } else {
    console.log('\n⚪ Using MySQL (legacy config)\n');
  }
  return pool;
}

/** Returns which database is currently active */
export function getActiveMode(): string | null {
  return activeMode;
}
