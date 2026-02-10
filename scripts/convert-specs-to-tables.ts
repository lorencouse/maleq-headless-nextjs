#!/usr/bin/env bun

/**
 * Convert Product Specs to Tables
 *
 * Converts .product-specs paragraphs to 2-column WordPress table blocks
 * Handles various formats:
 *   - "Label: Value" plain text
 *   - "<strong>Label:</strong> Value"
 *   - "<strong>Label<br>Label2</strong>" (features only)
 *   - Plain text features
 *
 * Usage:
 *   bun scripts/convert-specs-to-tables.ts [--dry-run]
 */

import { getConnection } from './lib/db';

interface SpecRow {
  label: string;
  value: string;
}

function parseProductSpecs(html: string): SpecRow[] {
  const rows: SpecRow[] = [];

  // Extract content between <p> tags
  const contentMatch = html.match(/<p[^>]*class="[^"]*product-specs[^"]*"[^>]*>([\s\S]*?)<\/p>/);
  if (!contentMatch) return rows;

  let content = contentMatch[1];

  // Split by <br>, <br/>, or <br />
  const lines = content
    .split(/<br\s*\/?>/gi)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  for (let line of lines) {
    // Remove leading/trailing strong tags that wrap the whole line
    line = line.replace(/^<strong>([\s\S]*)<\/strong>$/i, '$1');

    // Check for "Label: Value" pattern (with or without strong tags)
    // Pattern 1: <strong>Label:</strong> Value (value may contain links)
    const strongLabelMatch = line.match(/^<strong>([^<]+):<\/strong>\s*([\s\S]*)$/i);
    if (strongLabelMatch) {
      rows.push({
        label: strongLabelMatch[1].trim(),
        value: cleanValue(strongLabelMatch[2]) || '✓'
      });
      continue;
    }

    // Pattern 2: <strong>Label</strong>: Value
    const strongLabel2Match = line.match(/^<strong>([^<]+)<\/strong>:\s*([\s\S]*)$/i);
    if (strongLabel2Match) {
      rows.push({
        label: strongLabel2Match[1].trim(),
        value: cleanValue(strongLabel2Match[2]) || '✓'
      });
      continue;
    }

    // Pattern 3: Label: Value (plain text with colon, but value may contain HTML like links)
    // Only match colon that's not inside a URL (http: or https:)
    const colonMatch = line.match(/^([^:<]+):\s*([\s\S]+)$/);
    if (colonMatch && !colonMatch[2].match(/^\/\//)) {
      // Clean HTML tags from label only, preserve in value
      const label = colonMatch[1].replace(/<[^>]+>/g, '').trim();
      const value = cleanValue(colonMatch[2]);
      rows.push({ label, value });
      continue;
    }

    // Pattern 4: Feature only (no colon) - put in left column with checkmark
    const cleanLine = line.replace(/<[^>]+>/g, '').trim();
    if (cleanLine) {
      rows.push({
        label: cleanLine,
        value: '✓'
      });
    }
  }

  return rows;
}

function cleanValue(value: string): string {
  // Preserve <a> tags but remove other HTML tags like <strong>
  let cleaned = value.trim();

  // Remove <strong> and </strong> tags but keep content
  cleaned = cleaned.replace(/<\/?strong>/gi, '');

  // Remove <em> and </em> tags but keep content
  cleaned = cleaned.replace(/<\/?em>/gi, '');

  // Keep <a> tags intact
  return cleaned.trim();
}

function createTableBlock(rows: SpecRow[], hasHeader: boolean = false): string {
  if (rows.length === 0) return '';

  // Build table body HTML - don't escape since we want to preserve <a> tags
  // Left column (label) is bolded
  const tableRows = rows.map(row =>
    `<tr><td><strong>${sanitizeForTable(row.label)}</strong></td><td>${sanitizeForTable(row.value)}</td></tr>`
  ).join('');

  const tableHtml = `<figure class="wp-block-table product-table"><table class="has-fixed-layout"><tbody>${tableRows}</tbody></table></figure>`;

  // Create WordPress table block
  const block = `<!-- wp:table {"className":"product-table"} -->\n${tableHtml}\n<!-- /wp:table -->`;

  return block;
}

function sanitizeForTable(text: string): string {
  // Preserve <a> tags but escape other potentially harmful content
  // First, temporarily replace <a> tags with placeholders
  const linkPlaceholders: string[] = [];
  let sanitized = text.replace(/<a\s+[^>]*>[\s\S]*?<\/a>/gi, (match) => {
    linkPlaceholders.push(match);
    return `__LINK_PLACEHOLDER_${linkPlaceholders.length - 1}__`;
  });

  // Escape remaining HTML-like content (but not & which might be in URLs)
  sanitized = sanitized
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Restore <a> tags
  linkPlaceholders.forEach((link, i) => {
    sanitized = sanitized.replace(`__LINK_PLACEHOLDER_${i}__`, link);
  });

  return sanitized;
}

function convertSpecsInContent(content: string): { newContent: string; conversions: number } {
  let conversions = 0;

  // Match product-specs paragraphs
  const specsRegex = /<!-- wp:paragraph[^>]*\{"[^}]*className[^}]*product-specs[^}]*\}[^>]*-->\s*<p[^>]*class="[^"]*product-specs[^"]*"[^>]*>[\s\S]*?<\/p>\s*<!-- \/wp:paragraph -->/gi;

  const newContent = content.replace(specsRegex, (match) => {
    const rows = parseProductSpecs(match);

    if (rows.length === 0) {
      return match; // Keep original if no rows parsed
    }

    conversions++;
    return createTableBlock(rows);
  });

  return { newContent, conversions };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const verbose = process.argv.includes('--verbose');

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  Convert Product Specs to Tables                   ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  if (dryRun) {
    console.log('Mode: DRY RUN\n');
  }

  const connection = await getConnection();

  console.log('✓ Connected to MySQL\n');

  // Find all posts with product-specs
  const [posts] = await connection.execute(
    `SELECT ID, post_title, post_type, post_content
     FROM wp_posts
     WHERE post_content LIKE '%product-specs%'
     AND post_type IN ('wp_block', 'post', 'page', 'product')
     AND post_content LIKE '%<!-- wp:paragraph%'`
  ) as [any[], any];

  console.log(`📄 Found ${posts.length} posts with product-specs paragraphs\n`);

  let totalConversions = 0;
  let postsUpdated = 0;
  let errors = 0;

  for (const post of posts) {
    const { newContent, conversions } = convertSpecsInContent(post.post_content);

    if (conversions > 0) {
      totalConversions += conversions;

      if (verbose || dryRun) {
        console.log(`📝 Post #${post.ID} "${post.post_title}" - ${conversions} spec(s) to convert`);

        if (verbose) {
          // Show a preview of the conversion
          const rows = parseProductSpecs(post.post_content);
          if (rows.length > 0) {
            console.log('   Preview:');
            rows.slice(0, 3).forEach(r => console.log(`     ${r.label}: ${r.value}`));
            if (rows.length > 3) console.log(`     ... and ${rows.length - 3} more rows`);
          }
        }
      }

      if (!dryRun) {
        try {
          await connection.execute(
            'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
            [newContent, post.ID]
          );
          postsUpdated++;
        } catch (e: any) {
          console.error(`✗ Error updating post #${post.ID}:`, e.message);
          errors++;
        }
      } else {
        postsUpdated++;
      }
    }
  }

  await connection.end();

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  SUMMARY                                           ║');
  console.log('╠════════════════════════════════════════════════════╣');
  console.log(`║  📊 Total specs converted: ${String(totalConversions).padEnd(22)}║`);
  console.log(`║  📄 Posts updated: ${String(postsUpdated).padEnd(30)}║`);
  console.log(`║  ❌ Errors: ${String(errors).padEnd(38)}║`);
  console.log('╚════════════════════════════════════════════════════╝\n');

  if (dryRun && totalConversions > 0) {
    console.log('Run without --dry-run to apply changes.\n');
  }
}

main().catch(console.error);
