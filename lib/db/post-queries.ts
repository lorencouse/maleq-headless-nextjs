/**
 * Blog post SQL queries for sitemaps and cache warming.
 */
import { getPoolAsync } from './pool';
import type { RowDataPacket } from 'mysql2';

interface PostSlugRow extends RowDataPacket {
  post_name: string;
}

let cachedSlugs: string[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getAllPostSlugs(): Promise<string[]> {
  if (cachedSlugs && Date.now() - cacheTime < CACHE_TTL) {
    return cachedSlugs;
  }

  const pool = await getPoolAsync();
  const [rows] = await pool.query<PostSlugRow[]>(`
    SELECT post_name
    FROM wp_posts
    WHERE post_type = 'post' AND post_status = 'publish'
    ORDER BY post_date DESC
  `);

  cachedSlugs = rows.map(r => r.post_name);
  cacheTime = Date.now();
  return cachedSlugs;
}
