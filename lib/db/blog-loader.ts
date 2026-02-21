/**
 * Loads blog posts and taxonomies from MySQL.
 *
 * Handles post listings, category/tag pages, search, and taxonomy lookups.
 * Single post content (which needs reusable block rendering) stays on GraphQL
 * since WordPress's do_blocks() pipeline can't run from raw SQL.
 */
import { getPoolAsync } from './pool';
import type { RowDataPacket } from 'mysql2';
import type { Post } from '@/lib/types/wordpress';
import { getProductionImageUrl } from '@/lib/utils/image';

// ─── Row types ───

interface DbPost extends RowDataPacket {
  ID: number;
  post_title: string;
  post_name: string;      // slug
  post_excerpt: string;
  post_content: string;
  post_date: string;
  post_modified: string;
  comment_count: number;
  author_id: number;
  author_name: string;
  author_slug: string;
  author_email: string;
  thumb_url: string | null;
  thumb_alt: string | null;
}

interface DbTerm extends RowDataPacket {
  term_id: number;
  name: string;
  slug: string;
  description: string | null;
  count: number;
  taxonomy: string;
  object_id?: number;
}

interface DbComment extends RowDataPacket {
  comment_ID: number;
  comment_content: string;
  comment_date: string;
  comment_author: string;
  comment_author_email: string;
  comment_parent: number;
}

// ─── Caches ───

const CACHE_TTL = 5 * 60 * 1000;

interface CacheEntry<T> { data: T; time: number; }
const caches = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = caches.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data as T;
  return null;
}
function setCache<T>(key: string, data: T): void {
  caches.set(key, { data, time: Date.now() });
}

function encodeId(prefix: string, id: number): string {
  return Buffer.from(`${prefix}:${id}`).toString('base64');
}

function gravatarUrl(email: string): string {
  // Simple hash-less fallback — WordPress generates actual gravatar URLs
  return `https://secure.gravatar.com/avatar/?s=96&d=mm&r=g`;
}

// ─── Post assembly helpers ───

const POST_SELECT = `
  SELECT
    p.ID,
    p.post_title,
    p.post_name,
    p.post_excerpt,
    p.post_content,
    p.post_date,
    p.post_modified,
    p.comment_count,
    p.post_author AS author_id,
    u.display_name AS author_name,
    u.user_nicename AS author_slug,
    u.user_email AS author_email,
    thumb.guid AS thumb_url,
    (SELECT tm_alt.meta_value FROM wp_postmeta tm_alt
     WHERE tm_alt.post_id = thumb.ID AND tm_alt.meta_key = '_wp_attachment_image_alt' LIMIT 1) AS thumb_alt
  FROM wp_posts p
  LEFT JOIN wp_users u ON p.post_author = u.ID
  LEFT JOIN wp_postmeta pm_thumb ON p.ID = pm_thumb.post_id AND pm_thumb.meta_key = '_thumbnail_id'
    AND pm_thumb.meta_id = (
      SELECT MIN(pm2.meta_id) FROM wp_postmeta pm2
      WHERE pm2.post_id = p.ID AND pm2.meta_key = '_thumbnail_id'
    )
  LEFT JOIN wp_posts thumb ON thumb.ID = CAST(pm_thumb.meta_value AS UNSIGNED)
`;

const POST_BASE_WHERE = `p.post_type = 'post' AND p.post_status = 'publish'`;

async function attachTermsToPost(
  pool: Awaited<ReturnType<typeof getPoolAsync>>,
  postId: number
): Promise<{ categories: { id: string; name: string; slug: string }[]; tags: { id: string; name: string; slug: string }[] }> {
  const [terms] = await pool.query<DbTerm[]>(`
    SELECT t.term_id, t.name, t.slug, tt.taxonomy
    FROM wp_term_relationships tr
    JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
    JOIN wp_terms t ON tt.term_id = t.term_id
    WHERE tr.object_id = ? AND tt.taxonomy IN ('category', 'post_tag')
  `, [postId]);

  const categories = terms
    .filter(t => t.taxonomy === 'category')
    .map(t => ({ id: encodeId('term', t.term_id), name: t.name, slug: t.slug }));
  const tags = terms
    .filter(t => t.taxonomy === 'post_tag')
    .map(t => ({ id: encodeId('term', t.term_id), name: t.name, slug: t.slug }));

  return { categories, tags };
}

async function attachTermsToPosts(
  pool: Awaited<ReturnType<typeof getPoolAsync>>,
  postIds: number[]
): Promise<Map<number, { categories: { id: string; name: string; slug: string }[]; tags: { id: string; name: string; slug: string }[] }>> {
  if (postIds.length === 0) return new Map();

  const [terms] = await pool.query<DbTerm[]>(`
    SELECT t.term_id, t.name, t.slug, tt.taxonomy, tr.object_id
    FROM wp_term_relationships tr
    JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
    JOIN wp_terms t ON tt.term_id = t.term_id
    WHERE tr.object_id IN (?) AND tt.taxonomy IN ('category', 'post_tag')
  `, [postIds]);

  const result = new Map<number, { categories: { id: string; name: string; slug: string }[]; tags: { id: string; name: string; slug: string }[] }>();

  for (const postId of postIds) {
    result.set(postId, { categories: [], tags: [] });
  }

  for (const term of terms) {
    const entry = result.get(term.object_id!);
    if (!entry) continue;
    const mapped = { id: encodeId('term', term.term_id), name: term.name, slug: term.slug };
    if (term.taxonomy === 'category') entry.categories.push(mapped);
    else entry.tags.push(mapped);
  }

  return result;
}

function rowToPost(row: DbPost, terms?: { categories: { id: string; name: string; slug: string }[]; tags: { id: string; name: string; slug: string }[] }): Post {
  return {
    id: encodeId('post', row.ID),
    databaseId: row.ID,
    title: row.post_title,
    slug: row.post_name,
    content: row.post_content || '',
    excerpt: row.post_excerpt || '',
    date: new Date(row.post_date).toISOString(),
    modified: new Date(row.post_modified).toISOString(),
    commentCount: row.comment_count,
    author: {
      node: {
        id: encodeId('user', row.author_id),
        name: row.author_name || 'Male Q',
        slug: row.author_slug || 'maleq',
        avatar: { url: gravatarUrl(row.author_email || '') },
      },
    },
    featuredImage: row.thumb_url ? {
      node: {
        id: encodeId('post', 0),
        sourceUrl: getProductionImageUrl(row.thumb_url),
        altText: row.thumb_alt || row.post_title,
      },
    } : undefined,
    categories: terms ? { nodes: terms.categories } : undefined,
    tags: terms ? { nodes: terms.tags } : undefined,
  };
}

// ─── Blog categories ───

export interface BlogCategoryRow {
  id: string;
  name: string;
  slug: string;
  count: number;
  description?: string | null;
  databaseId?: number;
}

export async function loadBlogCategories(): Promise<BlogCategoryRow[]> {
  const cacheKey = 'blog-categories';
  const cached = getCached<BlogCategoryRow[]>(cacheKey);
  if (cached) return cached;

  const pool = await getPoolAsync();
  const [rows] = await pool.query<DbTerm[]>(`
    SELECT t.term_id, t.name, t.slug, tt.description, tt.count
    FROM wp_term_taxonomy tt
    JOIN wp_terms t ON tt.term_id = t.term_id
    WHERE tt.taxonomy = 'category' AND tt.count > 0
    ORDER BY t.name
  `);

  const result: BlogCategoryRow[] = rows.map(row => ({
    id: encodeId('term', row.term_id),
    name: row.name,
    slug: row.slug,
    count: row.count,
    description: row.description || null,
    databaseId: row.term_id,
  }));

  setCache(cacheKey, result);
  return result;
}

export async function loadBlogCategoryBySlug(slug: string): Promise<BlogCategoryRow | null> {
  const all = await loadBlogCategories();
  return all.find(c => c.slug === slug) ?? null;
}

// ─── Blog tags ───

export async function loadBlogTags(): Promise<BlogCategoryRow[]> {
  const cacheKey = 'blog-tags';
  const cached = getCached<BlogCategoryRow[]>(cacheKey);
  if (cached) return cached;

  const pool = await getPoolAsync();
  const [rows] = await pool.query<DbTerm[]>(`
    SELECT t.term_id, t.name, t.slug, tt.description, tt.count
    FROM wp_term_taxonomy tt
    JOIN wp_terms t ON tt.term_id = t.term_id
    WHERE tt.taxonomy = 'post_tag' AND tt.count > 0
    ORDER BY t.name
  `);

  const result: BlogCategoryRow[] = rows.map(row => ({
    id: encodeId('term', row.term_id),
    name: row.name,
    slug: row.slug,
    count: row.count,
    description: row.description || null,
    databaseId: row.term_id,
  }));

  setCache(cacheKey, result);
  return result;
}

export async function loadBlogTagBySlug(slug: string): Promise<BlogCategoryRow | null> {
  const all = await loadBlogTags();
  return all.find(t => t.slug === slug) ?? null;
}

// ─── Post listings ───

export interface PostListOptions {
  first?: number;
  offset?: number;
  categorySlug?: string;
  tagSlug?: string;
  excludeCategoryIds?: number[];
  search?: string;
  titleSearch?: string;
}

export async function loadBlogPosts(options: PostListOptions = {}): Promise<{
  posts: Post[];
  hasNextPage: boolean;
  total: number;
}> {
  const {
    first = 12,
    offset = 0,
    categorySlug,
    tagSlug,
    excludeCategoryIds,
    search,
    titleSearch,
  } = options;

  const pool = await getPoolAsync();
  const params: unknown[] = [];
  const joins: string[] = [];
  const wheres: string[] = [POST_BASE_WHERE];

  // Category filter (subquery to avoid row multiplication)
  if (categorySlug) {
    wheres.push(`p.ID IN (
      SELECT tr_cat.object_id
      FROM wp_term_relationships tr_cat
      JOIN wp_term_taxonomy tt_cat ON tr_cat.term_taxonomy_id = tt_cat.term_taxonomy_id
      JOIN wp_terms t_cat ON tt_cat.term_id = t_cat.term_id
      WHERE tt_cat.taxonomy = 'category' AND t_cat.slug = ?
    )`);
    params.push(categorySlug);
  }

  // Tag filter (subquery to avoid row multiplication)
  if (tagSlug) {
    wheres.push(`p.ID IN (
      SELECT tr_tag.object_id
      FROM wp_term_relationships tr_tag
      JOIN wp_term_taxonomy tt_tag ON tr_tag.term_taxonomy_id = tt_tag.term_taxonomy_id
      JOIN wp_terms t_tag ON tt_tag.term_id = t_tag.term_id
      WHERE tt_tag.taxonomy = 'post_tag' AND t_tag.slug = ?
    )`);
    params.push(tagSlug);
  }

  // Exclude categories
  if (excludeCategoryIds && excludeCategoryIds.length > 0) {
    wheres.push(`p.ID NOT IN (
      SELECT tr_ex.object_id
      FROM wp_term_relationships tr_ex
      JOIN wp_term_taxonomy tt_ex ON tr_ex.term_taxonomy_id = tt_ex.term_taxonomy_id
      WHERE tt_ex.taxonomy = 'category' AND tt_ex.term_id IN (?)
    )`);
    params.push(excludeCategoryIds);
  }

  // Title search
  if (titleSearch) {
    wheres.push(`p.post_title LIKE ?`);
    params.push(`%${titleSearch}%`);
  }

  // Full-text search (title + content + excerpt)
  if (search && !titleSearch) {
    wheres.push(`(p.post_title LIKE ? OR p.post_content LIKE ? OR p.post_excerpt LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = wheres.join(' AND ');
  const joinClause = joins.join('\n');

  // Count total
  const [countRows] = await pool.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(DISTINCT p.ID) as total FROM wp_posts p ${joinClause} WHERE ${whereClause}`,
    params
  );
  const total = countRows[0]?.total || 0;

  // Fetch posts (request one extra to detect hasNextPage)
  const fetchLimit = first + 1;
  const orderBy = search
    ? `ORDER BY CASE WHEN p.post_title LIKE ? THEN 0 ELSE 1 END, p.post_date DESC`
    : `ORDER BY p.post_date DESC`;

  const orderParams = search ? [`%${search}%`] : [];

  const [rows] = await pool.query<DbPost[]>(
    `${POST_SELECT} ${joinClause} WHERE ${whereClause} ${orderBy} LIMIT ? OFFSET ?`,
    [...params, ...orderParams, fetchLimit, offset]
  );

  const hasNextPage = rows.length > first;
  const postRows = rows.slice(0, first);

  // Batch-load terms for all posts
  const postIds = postRows.map(r => r.ID);
  const termsMap = await attachTermsToPosts(pool, postIds);

  const posts = postRows.map(row => rowToPost(row, termsMap.get(row.ID)));

  return { posts, hasNextPage, total };
}

// ─── Single post by slug (with comments, for detail pages) ───

export async function loadPostBySlug(slug: string): Promise<Post | null> {
  const pool = await getPoolAsync();

  const [rows] = await pool.query<DbPost[]>(
    `${POST_SELECT} WHERE ${POST_BASE_WHERE} AND p.post_name = ? LIMIT 1`,
    [slug]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  const terms = await attachTermsToPost(pool, row.ID);

  // Load comments
  const [commentRows] = await pool.query<DbComment[]>(`
    SELECT comment_ID, comment_content, comment_date, comment_author,
           comment_author_email, comment_parent
    FROM wp_comments
    WHERE comment_post_ID = ? AND comment_approved = '1'
    ORDER BY comment_date ASC
  `, [row.ID]);

  const post = rowToPost(row, terms);
  post.comments = {
    nodes: commentRows.map(c => ({
      id: encodeId('comment', c.comment_ID),
      content: c.comment_content,
      date: new Date(c.comment_date).toISOString(),
      author: {
        node: {
          name: c.comment_author,
          avatar: { url: gravatarUrl(c.comment_author_email) },
        },
      },
      parent: c.comment_parent > 0
        ? { node: { id: encodeId('comment', c.comment_parent) } }
        : undefined,
    })),
  };

  return post;
}

// ─── All post slugs (for static generation) ───

export async function loadAllPostSlugs(): Promise<string[]> {
  const cacheKey = 'all-post-slugs';
  const cached = getCached<string[]>(cacheKey);
  if (cached) return cached;

  const pool = await getPoolAsync();
  const [rows] = await pool.query<(RowDataPacket & { post_name: string })[]>(
    `SELECT post_name FROM wp_posts WHERE ${POST_BASE_WHERE} ORDER BY post_date DESC`
  );

  const slugs = rows.map(r => r.post_name);
  setCache(cacheKey, slugs);
  return slugs;
}

// ─── Resolve category slugs to database IDs ───

export async function resolveBlogCategoryIds(slugs: string[]): Promise<number[]> {
  const categories = await loadBlogCategories();
  const ids: number[] = [];
  for (const slug of slugs) {
    const cat = categories.find(c => c.slug === slug);
    if (cat?.databaseId) ids.push(cat.databaseId);
  }
  return ids;
}

// ─── Cache invalidation ───

export function invalidateBlogCache(): void {
  caches.clear();
}
