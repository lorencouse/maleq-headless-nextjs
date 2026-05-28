import { getPoolAsync, isMySQLConfigured } from './pool';
import {
  detectGuideLocale,
  getGuideLanguage,
  ROOT_LANGUAGE_SLUGS,
} from '@/lib/i18n/guide-languages';
import type { RowDataPacket } from 'mysql2';

export interface GuideSitemapEntry {
  /** post_name (already WP-encoded; e.g. %e6%9c%80... for CJK). */
  slug: string;
  /** hreflang → absolute URL map of this guide's language versions, when >1. */
  languages?: Record<string, string>;
}

function parseCsvIds(value: string | null | undefined): number[] {
  if (!value) return [];
  const out: number[] = [];
  for (const part of value.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Load every published guide with hreflang alternates for its linked
 * translations (en/es/zh/ja), for the sitemap. One query for all posts; groups
 * are resolved in memory from the `_maleq_translations` meta. Adds <xhtml:link
 * rel="alternate" hreflang> entries so search engines (esp. Baidu/Bing, which
 * lean on sitemap hreflang) see the cross-language relationships — complements
 * the per-page hreflang already emitted in the guide's <head>.
 */
export async function loadGuideSitemapEntries(siteUrl: string): Promise<GuideSitemapEntry[]> {
  if (!isMySQLConfigured()) return [];
  const pool = await getPoolAsync();
  const slugPlaceholders = ROOT_LANGUAGE_SLUGS.map(() => '?').join(',');

  const [rows] = await pool.query<
    (RowDataPacket & { ID: number; post_name: string; lang_slug: string | null; trans: string | null })[]
  >(
    `SELECT p.ID, p.post_name, MAX(t.slug) AS lang_slug,
            (SELECT meta_value FROM wp_postmeta pm
               WHERE pm.post_id = p.ID AND pm.meta_key = '_maleq_translations' LIMIT 1) AS trans
       FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
       JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug IN (${slugPlaceholders})
      WHERE p.post_type = 'post' AND p.post_status = 'publish'
      GROUP BY p.ID`,
    ROOT_LANGUAGE_SLUGS,
  );

  const byId = new Map<number, { slug: string; lang_slug: string | null }>();
  for (const r of rows) byId.set(r.ID, { slug: r.post_name, lang_slug: r.lang_slug });

  const entries: GuideSitemapEntry[] = [];
  for (const r of rows) {
    const selfLocale = detectGuideLocale(r.lang_slug ? [r.lang_slug] : []);
    if (!selfLocale) {
      entries.push({ slug: r.post_name });
      continue;
    }
    const languages: Record<string, string> = {};
    const selfLang = getGuideLanguage(selfLocale);
    if (selfLang) languages[selfLang.hreflang] = `${siteUrl}/guides/${r.post_name}`;

    for (const tid of parseCsvIds(r.trans)) {
      const sib = byId.get(tid);
      if (!sib || !sib.lang_slug) continue;
      const sibLocale = detectGuideLocale([sib.lang_slug]);
      if (!sibLocale) continue;
      const lang = getGuideLanguage(sibLocale);
      if (lang) languages[lang.hreflang] = `${siteUrl}/guides/${sib.slug}`;
    }

    entries.push({
      slug: r.post_name,
      languages: Object.keys(languages).length > 1 ? languages : undefined,
    });
  }
  return entries;
}
