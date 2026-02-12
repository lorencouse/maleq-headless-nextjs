#!/usr/bin/env bun
/**
 * Add /guides/ prefix to blog post links that were previously converted
 * from https://www.maleq.com/{slug}/ to /{slug}/ but should be /guides/{slug}/.
 *
 * Only targets href attributes containing bare blog slugs (not /wp-content/ images).
 *
 * Usage:
 *   bun scripts/fix-guides-prefix.ts --dry-run
 *   bun scripts/fix-guides-prefix.ts --apply
 */

import { getConnection } from './lib/db';

// All 54 blog slugs that need /guides/ prefix (exact current slugs)
const BLOG_SLUGS = [
  'best-anal-dilator-kits-butt-plug-trainer-sets-ranked',
  'best-anal-dildo',
  'best-anal-lubes',
  'best-anal-vibrators-for-men-prostate-sex-toys',
  'best-cock-rings',
  'best-condoms-for-anal-sex',
  'best-dildos-and-dongs',
  'best-kegel-exercises-for-women-better-orgasms',
  'best-lubes-for-masturbation-jacking-off',
  'best-lubes-without-glycerin-ranked',
  'best-lubes',
  'best-male-masturbator',
  'best-male-sex-toys',
  'best-penis-pumps',
  'best-prostate-massagers-stimulators',
  'best-sex-toys-for-women',
  'best-silicone-lube',
  'best-viagra-alternatives-2',
  'best-vibrators-for-women',
  'best-water-based-lube',
  'biggest-dildos-huge-sex-toys',
  'bleeding-after-anal-sex-what-to-do',
  'can-you-get-hiv-from-oral-sex',
  'clean-ass-anal-sex-visual-guide',
  'como-hacer-que-el-sexo-anal-no-duela-sino-que-se-sienta-bien-2',
  'como-usar-un-enema-anal-lavativa-antes-del-sexo',
  'el-mejor-lubricante-para-sexo-a-base-de-agua-2019',
  'hottest-bel-ami-gay-porn-stars',
  'how-a-woman-masturbates',
  'how-to-bottom-without-pain',
  'how-to-come-out-of-the-closet',
  'how-to-get-harder-erections-better-boners',
  'how-to-give-a-blowjob',
  'how-to-give-a-handjob',
  'how-to-have-anal-sex-for-the-first-time',
  'how-to-make-anal-sex-not-hurt',
  'how-to-milk-your-prostate-guide',
  'how-to-use-a-butt-plug',
  'how-to-use-a-cock-ring',
  'how-to-use-an-anal-enema-sex',
  'lavativas-para-hombres-usar-un-enema',
  'los-mejores-masturbadores-masculinos-para-resultados-explosivos',
  'los-mejores-relajantes-anales-para-un-sexo-anal-mas-comodo',
  'mejores-dildos-anales-que-debes-comrpar-en-2019',
  'mejores-lubricantes-anales-probados',
  'mejores-masajeadores-de-prostata-para-maxima-estimulacion-del-punto-p',
  'mejores-tapones-anales-para-maximo-placer-2019',
  'mejores-vibradores-anales-para-orgasmos-de-prostata-2019',
  'pjur-analyse-me-review-lube-made-anal-sex',
  'pjur-backdoor-review',
  'resena-de-pjur-backdoor-sexo-anal-verdaderamente-suave',
  'rimming-how-to-rim-and-get-rimmed',
  'the-best-anal-relaxants',
  'the-best-lubes-for-giving-a-handjob',
];

// Old renamed slugs → correct new path (old slug no longer matches current post)
const RENAMED_SLUG_MAP: Record<string, string> = {
  'best-anal-lubes-2016': '/guides/best-anal-lubes/',
  'best-prostate-stimulators-and-massagers': '/guides/best-prostate-massagers-stimulators/',
  'the-best-anal-dildo-for-beginners': '/guides/best-anal-dildo/',
  'the-best-cock-rings': '/guides/best-cock-rings/',
  'how-to-use-an-enema-anal-sex': '/guides/how-to-use-an-anal-enema-sex/',
  'the-best-butt-plugs': '/guides/best-butt-plugs-and-anal-stoppers/',
  'best-gay-dating-app-top-10-free-gay-apps': '/guides/best-gay-dating-apps/',
  'contact-us': '/contact/',
};

async function main() {
  const mode = process.argv[2];
  if (mode !== '--dry-run' && mode !== '--apply') {
    console.log('Usage: bun scripts/fix-guides-prefix.ts --dry-run|--apply');
    process.exit(1);
  }

  const dryRun = mode === '--dry-run';
  const conn = await getConnection();

  try {
    // Build LIKE conditions for all slugs (current + renamed)
    const allSlugs = [...BLOG_SLUGS, ...Object.keys(RENAMED_SLUG_MAP)];
    const likeConditions = allSlugs.map(s => `post_content LIKE '%"/${s}/%'`);

    const [rows] = await conn.query<any[]>(`
      SELECT ID, post_title, post_type, post_content
      FROM wp_posts
      WHERE post_status IN ('publish', 'draft')
        AND post_type IN ('post', 'page', 'wp_block')
        AND (${likeConditions.join(' OR ')})
      ORDER BY ID
    `);

    console.log(`Found ${rows.length} posts with bare blog slug links\n`);

    let updatedCount = 0;
    let totalReplacements = 0;

    for (const row of rows) {
      let content = row.post_content as string;
      let changed = false;
      let postCount = 0;

      // 1) Handle renamed slugs first (old slug → new path with /guides/)
      for (const [oldSlug, newPath] of Object.entries(RENAMED_SLUG_MAP)) {
        const patterns = [
          { old: `href="/${oldSlug}/"`, new: `href="${newPath}"` },
          { old: `href="/${oldSlug}"`, new: `href="${newPath}"` },
          { old: `href='/${oldSlug}/'`, new: `href='${newPath}'` },
          { old: `href='/${oldSlug}'`, new: `href='${newPath}'` },
        ];

        for (const p of patterns) {
          if (content.includes(p.old)) {
            const count = content.split(p.old).length - 1;
            content = content.replaceAll(p.old, p.new);
            changed = true;
            postCount += count;
            if (dryRun) console.log(`  ${p.old} → ${p.new}`);
          }
        }
      }

      // 2) Handle current slugs that just need /guides/ prefix
      for (const slug of BLOG_SLUGS) {
        const patterns = [
          { old: `href="/${slug}/"`, new: `href="/guides/${slug}/"` },
          { old: `href="/${slug}"`, new: `href="/guides/${slug}/"` },
          { old: `href='/${slug}/'`, new: `href='/guides/${slug}/'` },
          { old: `href='/${slug}'`, new: `href='/guides/${slug}/'` },
        ];

        for (const p of patterns) {
          if (content.includes(p.old)) {
            const count = content.split(p.old).length - 1;
            content = content.replaceAll(p.old, p.new);
            changed = true;
            postCount += count;
            if (dryRun) console.log(`  ${p.old} → ${p.new}`);
          }
        }
      }

      if (changed) {
        if (dryRun) {
          console.log(`[${row.post_type}] Post ${row.ID}: ${row.post_title} (${postCount} links)\n`);
        } else {
          await conn.query('UPDATE wp_posts SET post_content = ? WHERE ID = ?', [content, row.ID]);
          console.log(`Updated [${row.post_type}] ${row.ID}: ${row.post_title} (${postCount} links)`);
        }
        updatedCount++;
        totalReplacements += postCount;
      }
    }

    console.log('---');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLIED'}`);
    console.log(`Posts/blocks updated: ${updatedCount}`);
    console.log(`Total href replacements: ${totalReplacements}`);
  } finally {
    await conn.end();
  }
}

main().catch(console.error);
