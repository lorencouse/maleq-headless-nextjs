/**
 * Publish: insert a drafted post into WordPress as a DRAFT (status='draft'),
 * filed under the News category, tagged, with dedupe + attribution meta.
 *
 * Mirrors the wp_posts/wp_postmeta insert pattern in scripts/import-draft-posts.ts.
 * Nothing here ever publishes — that's the human approval step (Phase 1.5).
 */
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { META, NEWS_CATEGORY, DEFAULT_AUTHOR_ID } from './config';
import { slugify, type DraftedPost } from './draft';

const WP_URL = process.env.MALEQ_WP_URL || 'http://maleq-local.local';

function nowParts() {
  const d = new Date();
  const gmt = d.toISOString().slice(0, 19).replace('T', ' ');
  // Treat local == gmt for drafts; WP recalculates on publish.
  return { local: gmt, gmt };
}

/** Find a term_taxonomy_id by slug+taxonomy, creating the term if missing. */
async function resolveTerm(
  db: Connection,
  taxonomy: 'category' | 'post_tag',
  name: string,
  slug: string,
): Promise<number> {
  const [found] = await db.query<RowDataPacket[]>(
    `SELECT tt.term_taxonomy_id AS ttid
       FROM wp_terms t
       JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
      WHERE tt.taxonomy = ? AND t.slug = ? LIMIT 1`,
    [taxonomy, slug],
  );
  if (found.length) return Number(found[0].ttid);

  const [termRes] = await db.execute<ResultSetHeader>(
    `INSERT INTO wp_terms (name, slug, term_group) VALUES (?, ?, 0)`,
    [name, slug],
  );
  const termId = termRes.insertId;
  const [ttRes] = await db.execute<ResultSetHeader>(
    `INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count)
     VALUES (?, ?, '', 0, 0)`,
    [termId, taxonomy],
  );
  return ttRes.insertId;
}

/** Ensure post_name is unique by appending -2, -3, … if needed. */
async function uniqueSlug(db: Connection, base: string): Promise<string> {
  let slug = base || 'news-post';
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? slug : `${slug}-${n}`;
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT 1 FROM wp_posts WHERE post_name = ? LIMIT 1`,
      [candidate],
    );
    if (!rows.length) return candidate;
  }
  return `${slug}-${Date.now()}`;
}

export interface PublishResult {
  id: number;
  slug: string;
  title: string;
  editUrl: string;
}

export async function publishDraft(
  db: Connection,
  drafted: DraftedPost,
  opts: { authorId?: number } = {},
): Promise<PublishResult> {
  const authorId = opts.authorId ?? DEFAULT_AUTHOR_ID;
  const { local, gmt } = nowParts();
  const slug = await uniqueSlug(db, drafted.slug);

  await db.beginTransaction();
  try {
    // 1) wp_posts row (draft)
    const [postRes] = await db.execute<ResultSetHeader>(
      `INSERT INTO wp_posts (
         post_author, post_date, post_date_gmt, post_content, post_title,
         post_excerpt, post_status, comment_status, ping_status, post_password,
         post_name, to_ping, pinged, post_modified, post_modified_gmt,
         post_content_filtered, post_parent, guid, menu_order, post_type,
         post_mime_type, comment_count
       ) VALUES (?, ?, ?, ?, ?, ?, 'draft', 'open', 'open', '',
                 ?, '', '', ?, ?, '', 0, '', 0, 'post', '', 0)`,
      [authorId, local, gmt, drafted.contentHtml, drafted.title, drafted.excerpt, slug, local, gmt],
    );
    const postId = postRes.insertId;

    await db.execute(`UPDATE wp_posts SET guid = ? WHERE ID = ?`, [
      `${WP_URL}/?p=${postId}`,
      postId,
    ]);

    // 2) postmeta — dedupe marker + attribution + SEO + review flag
    const meta: [string, string][] = [
      [META.sourceUrl, drafted.item.url],
      [META.sourceUrls, JSON.stringify(drafted.usedSourceUrls)],
      [META.sourceName, drafted.item.sourceName],
      [META.sourceTitle, drafted.item.title],
      [META.generatedAt, new Date().toISOString()],
      [META.pending, '1'],
      [META.seoDescription, drafted.seoDescription.slice(0, 160)],
    ];
    if (drafted.item.imageUrl) meta.push([META.imageUrl, drafted.item.imageUrl]);
    if (drafted.coverQuery) meta.push([META.coverQuery, drafted.coverQuery]);
    if (drafted.coverPerson) meta.push([META.coverPerson, drafted.coverPerson]);
    if (drafted.coverHeadline) meta.push([META.coverHeadline, drafted.coverHeadline]);
    if (drafted.socialText) meta.push([META.socialText, drafted.socialText]);
    if (drafted.hashtags?.length) meta.push([META.hashtags, JSON.stringify(drafted.hashtags)]);
    for (const [k, v] of meta) {
      await db.execute(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
        [postId, k, v],
      );
    }

    // 3) category + tags via term_relationships, bumping counts
    const ttIds: number[] = [];
    ttIds.push(await resolveTerm(db, 'category', NEWS_CATEGORY.name, NEWS_CATEGORY.slug));
    for (const tag of drafted.tags.slice(0, 5)) {
      const tslug = slugify(tag);
      if (!tslug) continue;
      // Never tag with a slug that collides with the News category — a term used
      // as both category and post_tag becomes a WP "shared term" and breaks
      // category assignment in the admin (see docs).
      if (tslug === NEWS_CATEGORY.slug) continue;
      ttIds.push(await resolveTerm(db, 'post_tag', tag, tslug));
    }
    for (const ttid of [...new Set(ttIds)]) {
      await db.execute(
        `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
         VALUES (?, ?, 0)`,
        [postId, ttid],
      );
      await db.execute(
        `UPDATE wp_term_taxonomy SET count = count + 1 WHERE term_taxonomy_id = ?`,
        [ttid],
      );
    }

    await db.commit();
    return {
      id: postId,
      slug,
      title: drafted.title,
      editUrl: `${WP_URL}/wp-admin/post.php?post=${postId}&action=edit`,
    };
  } catch (e) {
    await db.rollback();
    throw e;
  }
}
