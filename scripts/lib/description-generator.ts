/**
 * Description Generator
 *
 * Constructs prompts from merged product data, calls the LLM,
 * validates and post-processes the HTML output.
 */

import type { LLMProvider } from './llm-provider';
import type { MergedProduct } from './product-data-merger';

export interface GeneratedDescription {
  html: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  status: 'success' | 'fallback' | 'error';
  error?: string;
}

const SYSTEM_PROMPT = `You are a professional e-commerce copywriter. You write engaging, SEO-optimized product descriptions in clean HTML.

Rules:
- Output ONLY valid HTML. No markdown, no code fences, no preamble.
- Use <h2> and <h3> tags for headings. Never use <h1>.
- Write in a professional, informative tone. Not overly salesy.
- Do not invent features or specifications not provided in the input data.
- Do not include price information in descriptions.
- Do not include any disclaimers or age-related warnings.
- Use <p> tags for paragraphs. Use <ul><li> for feature lists.`;

function buildParentPrompt(product: MergedProduct): string {
  const parts: string[] = [];

  parts.push(`Product: ${product.title}`);
  if (product.brand) parts.push(`Brand: ${product.brand}`);
  if (product.categories.length) parts.push(`Categories: ${product.categories.join(', ')}`);
  if (product.material) parts.push(`Material: ${product.material}`);

  if (Object.keys(product.mergedSpecifications).length > 0) {
    const specLines = Object.entries(product.mergedSpecifications)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    parts.push(`Specifications:\n${specLines}`);
  }

  if (product.mergedFeatures.length > 0) {
    parts.push(`Features: ${product.mergedFeatures.join('; ')}`);
  }

  if (product.mergedDescription) {
    // Truncate overly long source descriptions
    const desc = product.mergedDescription.substring(0, 1500);
    parts.push(`Existing description (rewrite and improve):\n${desc}`);
  }

  parts.push(`
Write an HTML product description (150-400 words) with this structure:
<h2>About the ${product.brand ? product.brand + ' ' : ''}${product.title}</h2>
<p>Overview paragraph describing the product and its appeal.</p>

<h3>Key Features</h3>
<ul><li>3-5 specific feature highlights</li></ul>

<h3>Specifications</h3>
<p>Product specs written in prose format (not a table).</p>

<h3>[Category-relevant heading like "Perfect For" or "How to Use"]</h3>
<p>Usage context or application.</p>

Output ONLY the HTML. No markdown. No code fences.`);

  return parts.join('\n\n');
}

function buildVariationPrompt(product: MergedProduct, parentTitle: string): string {
  const parts: string[] = [];

  parts.push(`This is a variation of: ${parentTitle}`);
  parts.push(`Variation name: ${product.title}`);

  if (product.mergedDescription) {
    parts.push(`Existing description: ${product.mergedDescription.substring(0, 500)}`);
  }

  parts.push(`Write a brief HTML description (50-100 words) for this product variation.
Focus on what makes this variant specific (size, color, style differences).
Use only <p> tags. No headings. No lists. Output ONLY HTML.`);

  return parts.join('\n\n');
}

function buildSeoPrompt(product: MergedProduct): string {
  return `Product: ${product.title}
Brand: ${product.brand || 'N/A'}
Categories: ${product.categories.join(', ') || 'N/A'}

Generate SEO metadata for this product. Return ONLY a JSON object with exactly these fields:
{
  "meta_title": "SEO title, max 60 characters, include brand and product type",
  "meta_description": "SEO description, max 155 characters, compelling and keyword-rich"
}

Output ONLY the JSON object. No markdown. No explanation.`;
}

// ─── Post-processing ───

/** Convert any markdown headings to HTML */
function markdownToHtml(text: string): string {
  let html = text;
  // Remove code fences
  html = html.replace(/```html?\s*/gi, '').replace(/```\s*/g, '');
  // Convert markdown headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  // Convert markdown bold/italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Convert markdown lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>\n${match}</ul>\n`);
  return html.trim();
}

/** Validate generated HTML has expected structure */
function validateParentHtml(html: string): boolean {
  const hasHeading = /<h[23]>/i.test(html);
  const hasParagraph = /<p>/i.test(html);
  const minLength = html.length >= 200;
  return hasHeading && hasParagraph && minLength;
}

function validateVariationHtml(html: string): boolean {
  return /<p>/i.test(html) && html.length >= 50;
}

/** Extract first 1-2 sentences for excerpt, max 160 chars */
function extractExcerpt(html: string): string {
  // Strip HTML tags
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // Get first 1-2 sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let excerpt = sentences[0] || text;
  if (excerpt.length < 100 && sentences.length > 1) {
    excerpt = sentences.slice(0, 2).join(' ');
  }
  if (excerpt.length > 160) {
    excerpt = excerpt.substring(0, 157) + '...';
  }
  return excerpt.trim();
}

/** Parse JSON from LLM response, handling common issues */
function parseSeoJson(response: string): { meta_title: string; meta_description: string } {
  // Strip markdown code fences
  let clean = response.replace(/```json?\s*/gi, '').replace(/```\s*/g, '').trim();
  // Try to extract JSON object
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) clean = match[0];

  try {
    const parsed = JSON.parse(clean);
    return {
      meta_title: (parsed.meta_title || '').substring(0, 60),
      meta_description: (parsed.meta_description || '').substring(0, 155),
    };
  } catch {
    return { meta_title: '', meta_description: '' };
  }
}

// ─── Public API ───

export async function generateDescription(
  llm: LLMProvider,
  product: MergedProduct,
  parentTitle?: string
): Promise<GeneratedDescription> {
  const isVariation = product.postType === 'product_variation';

  // Skip variations in large groups (>50 siblings)
  if (isVariation && product.variationCount > 50) {
    return {
      html: product.existingDescription || '',
      excerpt: product.existingExcerpt || '',
      metaTitle: '',
      metaDescription: '',
      status: 'fallback',
      error: 'Skipped: large variation group',
    };
  }

  // Skip if no description data at all
  if (!product.mergedDescription && product.mergedFeatures.length === 0 && !product.title) {
    return {
      html: '',
      excerpt: '',
      metaTitle: '',
      metaDescription: '',
      status: 'error',
      error: 'No source data available',
    };
  }

  try {
    // Generate main description
    const prompt = isVariation
      ? buildVariationPrompt(product, parentTitle || '')
      : buildParentPrompt(product);

    // Variations need fewer tokens than parents
    const maxTokens = isVariation ? 256 : 1024;

    let html = await llm.generate(prompt, { system: SYSTEM_PROMPT, temperature: 0.7, maxTokens });
    html = markdownToHtml(html);

    // Validate
    const valid = isVariation ? validateVariationHtml(html) : validateParentHtml(html);

    if (!valid) {
      // Retry once
      console.warn(`  ⚠ Validation failed for ${product.postId}, retrying...`);
      html = await llm.generate(prompt, { system: SYSTEM_PROMPT, temperature: 0.5, maxTokens });
      html = markdownToHtml(html);

      const retryValid = isVariation ? validateVariationHtml(html) : validateParentHtml(html);
      if (!retryValid) {
        return {
          html: product.existingDescription || '',
          excerpt: product.existingExcerpt || '',
          metaTitle: '',
          metaDescription: '',
          status: 'fallback',
          error: 'Generated HTML failed validation after retry',
        };
      }
    }

    const excerpt = extractExcerpt(html);

    // Generate SEO metadata (only for parent products)
    let metaTitle = '';
    let metaDescription = '';
    if (!isVariation) {
      const seoResponse = await llm.generate(buildSeoPrompt(product), {
        temperature: 0.3,
        maxTokens: 256,
      });
      const seo = parseSeoJson(seoResponse);
      metaTitle = seo.meta_title;
      metaDescription = seo.meta_description;
    }

    return {
      html,
      excerpt,
      metaTitle,
      metaDescription,
      status: 'success',
    };
  } catch (err: any) {
    return {
      html: product.existingDescription || '',
      excerpt: product.existingExcerpt || '',
      metaTitle: '',
      metaDescription: '',
      status: 'error',
      error: err.message,
    };
  }
}
