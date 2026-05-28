/**
 * Read layer for guide translations managed by the `maleq-post-translations`
 * mu-plugin.
 *
 * Each post stores the IDs of its sibling-language versions as ordered CSV in
 * one protected meta key:
 *
 *   _maleq_translations → CSV of related post IDs (the post's translation set)
 *
 * The save handler keeps the set symmetric, so a single 1-hop lookup is enough
 * to render a complete language switcher on any post. A sibling's language is
 * derived from its root "language" category (see lib/i18n/guide-languages.ts).
 */
import { getPoolAsync } from './pool';
import {
  detectGuideLocale,
  getGuideLanguage,
  localeOrder,
  ROOT_LANGUAGE_SLUGS,
  type GuideLocale,
} from '@/lib/i18n/guide-languages';
import type { RowDataPacket } from 'mysql2';

const TRANSLATIONS_META = '_maleq_translations';

export interface PostTranslation {
  postId: number;
  title: string;
  /** Slug under /guides/{slug}. */
  slug: string;
  locale: GuideLocale;
  hreflang: string;
  nativeLabel: string;
}

/** Parse a stored CSV meta value into a clean, order-preserving int list. */
function parseCsvIds(value: string | null | undefined): number[] {
  if (!value) return [];
  const out: number[] = [];
  for (const part of value.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** The sibling post IDs an editor linked as translations of `postId`. */
export async function loadTranslationIds(postId: number): Promise<number[]> {
  if (!postId) return [];

  const pool = await getPoolAsync();
  const [rows] = await pool.query<(RowDataPacket & { meta_value: string | null })[]>(
    `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ? LIMIT 1`,
    [postId, TRANSLATIONS_META],
  );
  return parseCsvIds(rows[0]?.meta_value);
}

/**
 * Resolve sibling post IDs → published {title, slug, language}, ordered by
 * language (English → Spanish → Chinese → Japanese) and de-duplicated so at
 * most one entry appears per language. Posts that are unpublished, missing, or
 * have no detectable language are dropped.
 */
export async function loadPostTranslations(
  postId: number,
): Promise<PostTranslation[]> {
  const ids = await loadTranslationIds(postId);
  if (ids.length === 0) return [];

  const pool = await getPoolAsync();
  const idPlaceholders = ids.map(() => '?').join(',');
  const slugPlaceholders = ROOT_LANGUAGE_SLUGS.map(() => '?').join(',');

  // One row per post; MAX(t.slug) collapses the per-category join down to the
  // single matching root-language slug (a post has at most one).
  const [rows] = await pool.query<
    (RowDataPacket & { ID: number; post_title: string; post_name: string; lang_slug: string | null })[]
  >(
    `SELECT p.ID,
            ANY_VALUE(p.post_title) AS post_title,
            ANY_VALUE(p.post_name)  AS post_name,
            MAX(t.slug)             AS lang_slug
       FROM wp_posts p
       LEFT JOIN wp_term_relationships tr ON tr.object_id = p.ID
       LEFT JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
       LEFT JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug IN (${slugPlaceholders})
      WHERE p.ID IN (${idPlaceholders})
        AND p.post_type = 'post'
        AND p.post_status = 'publish'
      GROUP BY p.ID`,
    [...ROOT_LANGUAGE_SLUGS, ...ids],
  );

  const byId = new Map(rows.map((r) => [r.ID, r]));

  // Walk the IDs in editor order so per-language de-dup keeps the first choice.
  const seenLocales = new Set<GuideLocale>();
  const out: PostTranslation[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || !row.lang_slug) continue;
    const locale = detectGuideLocale([row.lang_slug]);
    if (!locale || seenLocales.has(locale)) continue;
    const lang = getGuideLanguage(locale);
    if (!lang) continue;
    seenLocales.add(locale);
    out.push({
      postId: row.ID,
      title: row.post_title,
      slug: row.post_name,
      locale,
      hreflang: lang.hreflang,
      nativeLabel: lang.nativeLabel,
    });
  }

  out.sort((a, b) => localeOrder(a.locale) - localeOrder(b.locale));
  return out;
}
