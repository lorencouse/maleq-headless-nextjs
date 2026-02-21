/**
 * MySQL connection pool singleton for runtime product queries.
 *
 * Supports automatic fallback: tries local socket first (Local by Flywheel),
 * and if that's not available, falls back to production via SSH tunnel.
 * Actually tests each connection before committing to it.
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
import { existsSync } from 'fs';

let pool: Pool | null = null;
let activeMode: 'local' | 'prod' | 'legacy' | null = null;
let initPromise: Promise<Pool> | null = null;

interface DBConfig {
  mode: 'local' | 'prod' | 'legacy';
  socketPath?: string;
  host?: string;
  port?: number;
  database: string;
  user: string;
  password: string;
}

function getLocalConfig(): DBConfig | null {
  const socket = process.env.MYSQL_LOCAL_SOCKET;
  const db = process.env.MYSQL_LOCAL_DB;
  const user = process.env.MYSQL_LOCAL_USER;
  const pass = process.env.MYSQL_LOCAL_PASS;
  if (!socket || !db || !user || !pass) return null;
  if (!existsSync(socket)) return null;
  return { mode: 'local', socketPath: socket, database: db, user, password: pass };
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

function getAllConfigs(): DBConfig[] {
  const configs: DBConfig[] = [];
  const local = getLocalConfig();
  if (local) configs.push(local);
  const prod = getProdConfig();
  if (prod) configs.push(prod);
  const legacy = getLegacyConfig();
  if (legacy) configs.push(legacy);
  return configs;
}

function createPoolFromConfig(config: DBConfig): Pool {
  const isRemote = !config.socketPath;
  return mysql.createPool({
    ...(config.socketPath
      ? { socketPath: config.socketPath }
      : { host: config.host, port: config.port }),
    database: config.database,
    user: config.user,
    password: config.password,
    connectionLimit: isRemote ? 5 : 10,
    maxIdle: isRemote ? 1 : 5,
    idleTimeout: isRemote ? 10_000 : 60_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: isRemote ? 5_000 : 10_000,
  });
}

function logMode(config: DBConfig) {
  activeMode = config.mode;
  if (config.mode === 'local') {
    console.log('\n🟢 Using Local DB (Local by Flywheel)\n');
  } else if (config.mode === 'prod') {
    console.log('\n🟠 Using Production DB (wp.maleq.com via SSH tunnel)\n');
  } else {
    console.log('\n⚪ Using MySQL (legacy config)\n');
  }
}

/**
 * Initialize pool with connection testing and automatic fallback.
 * Tries local → prod → legacy, verifying each can actually connect.
 */
async function initPool(): Promise<Pool> {
  const configs = getAllConfigs();

  if (configs.length === 0) {
    throw new Error(
      'MySQL is not configured — set MYSQL_LOCAL_* or MYSQL_PROD_* (or legacy MYSQL_*) env vars',
    );
  }

  for (const config of configs) {
    const candidate = createPoolFromConfig(config);
    try {
      const conn = await candidate.getConnection();
      conn.release();
      pool = candidate;
      logMode(config);
      return pool;
    } catch {
      await candidate.end().catch(() => {});
      if (config.mode === 'local') {
        console.log('⚠️  Local MySQL socket exists but is not responding — falling back…');
      }
    }
  }

  // All configs failed — use first config so callers get proper errors
  const fallback = configs[0];
  pool = createPoolFromConfig(fallback);
  logMode(fallback);
  console.warn('⚠️  Warning: MySQL connection test failed for all configurations');
  return pool;
}

export function isMySQLConfigured(): boolean {
  return getAllConfigs().length > 0;
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
    const p = await getPoolAsync();
    const conn = await p.getConnection();
    conn.release();
    reachableResult = true;
  } catch {
    reachableResult = false;
  }
  reachableCheckedAt = now;
  return reachableResult;
}

/**
 * Get the connection pool (async, with connection testing & fallback).
 * Preferred — ensures the returned pool is actually connected.
 */
export async function getPoolAsync(): Promise<Pool> {
  if (pool) return pool;
  if (!initPromise) {
    initPromise = initPool();
  }
  return initPromise;
}

/**
 * Get the connection pool (sync).
 *
 * Returns the pool immediately if already initialized (via getPoolAsync or
 * a prior getPool call). Otherwise kicks off async init in background and
 * returns a temporary pool — which may point at a dead local socket.
 *
 * **Prefer getPoolAsync() in async contexts** to guarantee fallback works.
 */
export function getPool(): Pool {
  if (pool) return pool;

  // Start async init (will test & fallback properly)
  if (!initPromise) {
    initPromise = initPool();
  }

  // Return a temporary pool from the best-guess config.
  // Once initPool resolves, the global `pool` will be set to the tested one.
  const configs = getAllConfigs();
  if (configs.length === 0) {
    throw new Error(
      'MySQL is not configured — set MYSQL_LOCAL_* or MYSQL_PROD_* (or legacy MYSQL_*) env vars',
    );
  }

  // Skip local if we know it might be stale — prefer prod for sync fallback
  const safeFallback = configs.find(c => c.mode !== 'local') || configs[0];
  const tempPool = createPoolFromConfig(safeFallback);
  logMode(safeFallback);
  pool = tempPool;

  // Let async init replace this pool once it has a tested connection
  initPromise.then(testedPool => {
    if (pool === tempPool) {
      pool = testedPool;
    }
  }).catch(() => {});

  return pool;
}

/** Returns which database is currently active */
export function getActiveMode(): string | null {
  return activeMode;
}
