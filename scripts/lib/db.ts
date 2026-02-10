/**
 * Shared database connection module for CLI scripts.
 *
 * Usage:
 *   import { getConnection } from './lib/db';
 *   const db = await getConnection();
 *   // ... use db ...
 *   await db.end();
 */
import mysql from 'mysql2/promise';

const config = {
  socketPath: process.env.MYSQL_SOCKET || '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock',
  database: process.env.MYSQL_DB || 'local',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASS || 'root',
};

export async function getConnection() {
  return mysql.createConnection(config);
}

export { config };
