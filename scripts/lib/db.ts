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
 *   Default (no flags): connects to local WordPress via socket (Local by Flywheel)
 *   --remote:           connects via SSH tunnel to production DB (maleq-wp)
 *   --remote --db NAME: connects via SSH tunnel to a specific DB (e.g. maleq-wp-test)
 *
 * Requires SSH tunnel for remote: ssh -L 3307:127.0.0.1:3306 root@159.69.220.162
 */
import mysql from 'mysql2/promise';

const isRemote = process.argv.includes('--remote') || process.env.MYSQL_REMOTE === '1';

/** Parse --db flag value from argv */
function getDbFlag(): string | undefined {
  const idx = process.argv.indexOf('--db');
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

const dbOverride = getDbFlag();

const localConfig = {
  socketPath: process.env.MYSQL_SOCKET || '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock',
  database: dbOverride || process.env.MYSQL_DB || 'local',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASS || 'root',
};

const remoteConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: parseInt(process.env.MYSQL_PORT || '3307', 10),
  database: dbOverride || process.env.MYSQL_DB || 'maleq-wp',
  user: process.env.MYSQL_USER || 'maleq-wp',
  password: process.env.MYSQL_PASS || 'S9meeDoehU8VPiHd1ByJ',
};

const config = isRemote ? remoteConfig : localConfig;

export async function getConnection() {
  if (isRemote) {
    console.log(`🔗 Connecting to REMOTE database (${remoteConfig.host}:${remoteConfig.port}/${config.database})`);
    console.log('   SSH tunnel required: ssh -L 3307:127.0.0.1:3306 root@159.69.220.162\n');
  }
  return mysql.createConnection(config);
}

export { config };
