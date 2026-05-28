import { cache } from 'react';
import { getPoolAsync, isMySQLConfigured } from './pool';
import {
  detectGuideLocale,
  ROOT_LANGUAGE_SLUGS,
  DEFAULT_GUIDE_LOCALE,
  type GuideLocale,
} from '@/lib/i18n/guide-languages';
import type { RowDataPacket } from 'mysql2';

/**
 * Resolve the UI locale for a guide post from its top-level "language" category
 * (see lib/i18n/guide-languages.ts). Used by the guide-post layout to render
 * the chrome — and by the page to render its own UI — in the post's own
 * language (en/es/zh/ja), so a Spanish guide shows a Spanish site shell.
 *
 * Looks up by slug via direct SQL (cheap, one indexed lookup). `cache()`
 * dedupes the query across the layout + page render of a single request.
 * Resolves entirely from the URL slug (no cookies/headers), so it is safe on
 * the ISR content-root guide routes. Falls back to the default locale when the
 * post is missing, uncategorised, or MySQL is unavailable.
 */
export const getGuideLocaleBySlug = cache(async (slug: string): Promise<GuideLocale> => {
  if (!slug) return DEFAULT_GUIDE_LOCALE;
  try {
    if (!isMySQLConfigured()) return DEFAULT_GUIDE_LOCALE;
    const pool = await getPoolAsync();
    const slugPlaceholders = ROOT_LANGUAGE_SLUGS.map(() => '?').join(',');
    const [rows] = await pool.query<(RowDataPacket & { slug: string })[]>(
      `SELECT t.slug
         FROM wp_posts p
         JOIN wp_term_relationships tr ON tr.object_id = p.ID
         JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
         JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug IN (${slugPlaceholders})
        WHERE p.post_name = ? AND p.post_type = 'post' AND p.post_status = 'publish'
        LIMIT 5`,
      [...ROOT_LANGUAGE_SLUGS, slug],
    );
    return detectGuideLocale(rows.map((r) => r.slug)) ?? DEFAULT_GUIDE_LOCALE;
  } catch {
    return DEFAULT_GUIDE_LOCALE;
  }
});
