/**
 * Shared database connection module for CLI scripts.
 *
 * Usage:
 *   import { getConnection } from './lib/db';
 *   const db = await getConnection();
 *   // ... use db ...
 *   await db.end();
 *
 * Modes:
 *   Default (no flags): connects via SSH tunnel to production DB (maleq-wp)
 *   --local:            connects to local WordPress via socket (Local by Flywheel)
 *   --db NAME:          override database name (e.g. maleq-wp-test)
 *
 * Requires SSH tunnel for remote: ssh -L 3307:127.0.0.1:3306 root@159.69.220.162
 */
import mysql from 'mysql2/promise';
import { detectLocalMysqlSocket } from '../../lib/db/local-runtime';

const isLocal = process.argv.includes('--local') || process.env.MYSQL_LOCAL === '1';
// Legacy flag support
const isRemote = !isLocal || process.argv.includes('--remote') || process.env.MYSQL_REMOTE === '1';

/** Parse --db flag value from argv */
function getDbFlag(): string | undefined {
  const idx = process.argv.indexOf('--db');
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

const dbOverride = getDbFlag();
const explicitLocalSocket = process.env.MYSQL_SOCKET || process.env.DEV_MYSQL_SOCKET;
const detectedLocalSocket =
  detectLocalMysqlSocket(explicitLocalSocket || undefined) ||
  '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';

const localConfig = {
  socketPath: detectedLocalSocket,
  database: dbOverride || process.env.MYSQL_DB || 'local',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASS || 'root',
};

const remotePassword =
  process.env.REMOTE_MYSQL_PASS || process.env.MYSQL_PROD_PASS || process.env.MYSQL_PASS;

const remoteConfig = {
  host: process.env.REMOTE_MYSQL_HOST || process.env.MYSQL_PROD_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: parseInt(process.env.REMOTE_MYSQL_PORT || process.env.MYSQL_PROD_PORT || process.env.MYSQL_PORT || '3307', 10),
  database: dbOverride || process.env.REMOTE_MYSQL_DB || process.env.MYSQL_PROD_DB || process.env.MYSQL_DB || 'maleq-wp',
  user: process.env.REMOTE_MYSQL_USER || process.env.MYSQL_PROD_USER || process.env.MYSQL_USER || 'maleq-wp',
  password: remotePassword,
  ssl: { rejectUnauthorized: false },
};

const config = isLocal ? localConfig : remoteConfig;

export async function getConnection() {
  if (!isLocal) {
    if (!remotePassword) {
      throw new Error(
        'Missing remote DB password: set MYSQL_PROD_PASS (or REMOTE_MYSQL_PASS) in .env.local. ' +
          'Credentials must never be hardcoded in this repo.'
      );
    }
    console.log(`🔗 Connecting to REMOTE database (${remoteConfig.host}:${remoteConfig.port}/${config.database})`);
    if (remoteConfig.host === '127.0.0.1' && remoteConfig.port === 3307) {
      console.log('   SSH tunnel required: ssh -L 3307:127.0.0.1:3306 root@159.69.220.162\n');
    } else {
      console.log('   Direct connection (no SSH tunnel)\n');
    }
  } else {
    console.log(`🔗 Connecting to LOCAL database (${localConfig.database})\n`);
  }
  return mysql.createConnection(config);
}

export { config };
