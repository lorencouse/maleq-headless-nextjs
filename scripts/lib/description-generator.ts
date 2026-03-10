/**
 * Description Generator V3
 *
 * Three-path architecture based on word count:
 *  - Enhance: >= 400 words → light touch, preserve base text, fix & improve
 *  - Reformat: 100–399 words → restructure with creative license, build upon existing
 *  - Generate: < 100 words → fresh content with varied templates
 *
 * Variation handling:
 *  - Parent descriptions are informed by all child variation descriptions
 *  - Variation descriptions focus on what makes each variant unique
 *
 * Category-aware profiles × rotating structure variants = diverse output.
 */

import type { LLMProvider, LLMGenerateOptions } from './llm-provider';
import type { MergedProduct } from './product-data-merger';

// ─── Types ───

export interface GeneratedDescription {
  html: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  status: 'success' | 'fallback' | 'error';
  error?: string;
  path: 'enhance' | 'reformat' | 'generate' | 'variation' | 'skipped';
  categoryProfile?: string;
  structureVariant?: number;
}

type EnrichmentPath = 'enhance' | 'reformat' | 'generate';

interface CategoryProfile {
  id: string;
  /** Category name fragments that trigger this profile (matched case-insensitively) */
  matchTerms: string[];
  headingSuggestions: string[];
  toneGuidance: string;
  usageAngle: string;
}

interface StructureVariant {
  id: number;
  style: string;
  template: string;
}

// ─── System Prompt ───

const SYSTEM_PROMPT_V2 = `You are a knowledgeable product copywriter for an adult novelty e-commerce store. You write like someone who has actually handled and evaluated each product.

Rules:
- Output ONLY valid HTML. No markdown, no code fences, no preamble, no sign-offs.
- Use <h2> and <h3> tags for headings. Never use <h1>.
- Use <p> tags for paragraphs. Use <ul><li> for feature lists only when the prompt calls for them.
- Preserve existing <table>, <thead>, <tbody>, <tr>, <td>, <th>, and <ol> structures exactly. Do not remove, simplify, or convert tables to lists/prose or ordered lists to unordered lists.
- Vary your sentence length. Mix short punchy sentences with longer descriptive ones.
- Do not invent features or specifications not provided in the input data.
- Do not include price information.
- Do not include disclaimers or age-related warnings.

Avoid these generic filler phrases:
- "Whether you're a beginner or experienced"
- "Takes your pleasure to the next level"
- "Look no further"
- "This product is perfect for"
- "You won't be disappointed"
- "In the world of adult toys"

Instead, be specific about what the product does and how it feels. Ground every claim in the provided data.`;

// ─── Category Profiles ───

const CATEGORY_PROFILES: CategoryProfile[] = [
  {
    id: 'vibrators',
    matchTerms: ['vibrator', 'vibe', 'bullet', 'wand', 'massager', 'clitoral', 'g-spot'],
    headingSuggestions: ['How It Feels', 'Vibration Modes', 'Power & Performance', 'Design Details', 'What Sets It Apart'],
    toneGuidance: 'Focus on sensation, vibration patterns, and ergonomic design. Be specific about motor strength and noise level if data is available.',
    usageAngle: 'Describe the physical experience and what body areas it targets.',
  },
  {
    id: 'dildos',
    matchTerms: ['dildo', 'dong', 'phallus', 'realistic', 'strap-on', 'strap on'],
    headingSuggestions: ['Shape & Texture', 'Material Feel', 'Size & Fit', 'Design Notes', 'What Makes It Different'],
    toneGuidance: 'Emphasize texture, flexibility, and material quality. Describe the physical form factor clearly.',
    usageAngle: 'Describe how the shape and texture translate to use. Mention harness compatibility if relevant.',
  },
  {
    id: 'anal',
    matchTerms: ['anal', 'butt plug', 'prostate', 'beads'],
    headingSuggestions: ['Shape & Comfort', 'Material & Safety', 'Graduated Sizing', 'Design Details', 'Build & Feel'],
    toneGuidance: 'Emphasize safety features (flared base, body-safe materials), graduated sizing, and comfort. Be matter-of-fact.',
    usageAngle: 'Focus on comfort, safety features, and progressive design for ease of use.',
  },
  {
    id: 'masturbators',
    matchTerms: ['masturbator', 'stroker', 'sleeve', 'fleshlight', 'pocket', 'blow job', 'blowjob', 'oral simulator'],
    headingSuggestions: ['Internal Texture', 'Grip & Control', 'Material Feel', 'Cleanup & Care', 'What Sets It Apart'],
    toneGuidance: 'Describe internal texture patterns specifically. Mention suction, tightness, and ease of cleaning.',
    usageAngle: 'Focus on the internal channel design and how the textures create stimulation.',
  },
  {
    id: 'bondage',
    matchTerms: ['bondage', 'restraint', 'cuff', 'collar', 'leash', 'paddle', 'whip', 'flogger', 'blindfold', 'gag', 'bdsm', 'fetish'],
    headingSuggestions: ['Build & Quality', 'Hardware & Fasteners', 'Comfort & Fit', 'Design Details', 'Craftsmanship'],
    toneGuidance: 'Focus on build quality, materials (leather, metal, neoprene), hardware durability, and adjustability. Professional tone.',
    usageAngle: 'Describe construction quality and adjustability. Mention quick-release or safety features if present.',
  },
  {
    id: 'lingerie',
    matchTerms: ['lingerie', 'chemise', 'corset', 'babydoll', 'teddy', 'bodystocking', 'panty', 'panties', 'bra', 'thong', 'garter', 'hosiery', 'costume', 'role play'],
    headingSuggestions: ['Fabric & Feel', 'Fit & Sizing', 'Design Details', 'Styling Notes', 'The Look'],
    toneGuidance: 'Describe fabric texture, stretch, and visual appeal. Mention sizing details and styling possibilities.',
    usageAngle: 'Focus on how the garment looks and feels when worn. Mention styling or layering options.',
  },
  {
    id: 'lubricants',
    matchTerms: ['lubricant', 'lube', 'oil', 'cream', 'gel', 'glide', 'moisturizer', 'enhancement', 'arousal', 'desensitizer', 'delay'],
    headingSuggestions: ['Formula & Feel', 'Ingredients', 'Compatibility', 'Application', 'What to Know'],
    toneGuidance: 'Be specific about formula type (water/silicone/hybrid), texture, and toy/condom compatibility. Clinical accuracy matters.',
    usageAngle: 'Focus on formula properties, compatibility with materials, and application advice.',
  },
  {
    id: 'default',
    matchTerms: [],
    headingSuggestions: ['Overview', 'Key Details', 'What Stands Out', 'Design & Build', 'Worth Noting'],
    toneGuidance: 'Write in a clear, informative tone. Focus on what the product is, what it is made of, and what makes it notable.',
    usageAngle: 'Describe the product straightforwardly, focusing on its primary function and standout qualities.',
  },
];

// ─── Structure Variants (Generate path only) ───

const STRUCTURE_VARIANTS: StructureVariant[] = [
  {
    id: 0,
    style: 'Overview + feature list + specs prose',
    template: `Write an HTML product description (150–400 words) with this structure:

<h2>HEADING_A</h2>
<p>Opening overview paragraph. What is this product, who makes it, and why does it stand out?</p>

<h3>HEADING_B</h3>
<ul><li>3–6 specific features drawn from the data. No generic filler.</li></ul>

<h3>Specifications</h3>
<p>Work the specs into flowing prose. Do not use a table or a second list.</p>`,
  },
  {
    id: 1,
    style: 'Flowing narrative prose (no bullet lists)',
    template: `Write an HTML product description (150–400 words) as flowing prose. Do NOT use any <ul> or <li> tags.

<h2>HEADING_A</h2>
<p>Opening paragraph introducing the product and its appeal.</p>

<h3>HEADING_B</h3>
<p>Second paragraph diving into features, materials, and design. Weave specs naturally into the text.</p>

<h3>HEADING_C</h3>
<p>Closing paragraph with usage context or standout qualities.</p>`,
  },
  {
    id: 2,
    style: 'Lead with standout feature',
    template: `Write an HTML product description (150–400 words). Lead with the single most interesting feature or detail.

<h2>HEADING_A</h2>
<p>Open with the product's standout feature or most compelling detail. Hook the reader immediately.</p>

<h3>HEADING_B</h3>
<p>Expand on the rest of the product: design, materials, other features.</p>

<h3>Specifications</h3>
<p>Key specs in prose form.</p>`,
  },
  {
    id: 3,
    style: 'Question-based headings',
    template: `Write an HTML product description (150–400 words) using question-style headings.

<h2>What Is the PRODUCT_NAME?</h2>
<p>Answer: describe the product and its purpose.</p>

<h3>HEADING_A</h3>
<p>Answer with specific features and design details.</p>

<h3>HEADING_B</h3>
<p>Answer with specs, materials, or usage context.</p>`,
  },
  {
    id: 4,
    style: 'Short and punchy (minimal data products)',
    template: `Write a concise HTML product description (80–200 words). Keep it tight — this product has limited data, so do not pad or repeat.

<h2>HEADING_A</h2>
<p>One strong paragraph covering what the product is, its key features, and material/specs. Be direct.</p>

<h3>HEADING_B</h3>
<p>One short closing paragraph with any remaining details or usage context.</p>`,
  },
];

// ─── Classification ───

/** Count words in HTML content (strips tags first) */
function wordCount(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

export function classifyProduct(product: MergedProduct): EnrichmentPath {
  const words = wordCount(product.mergedDescription || '');
  if (words >= 400) return 'enhance';
  if (words >= 100) return 'reformat';
  return 'generate';
}

export function matchCategoryProfile(product: MergedProduct): CategoryProfile {
  const searchText = [
    product.title,
    ...product.categories,
  ].join(' ').toLowerCase();

  for (const profile of CATEGORY_PROFILES) {
    if (profile.id === 'default') continue;
    if (profile.matchTerms.some((term) => searchText.includes(term))) {
      return profile;
    }
  }
  return CATEGORY_PROFILES[CATEGORY_PROFILES.length - 1]; // default
}

// ─── Prompt Builders ───

function buildProductContext(product: MergedProduct): string {
  const parts: string[] = [];

  parts.push(`Product: ${product.title}`);
  if (product.brand) parts.push(`Brand: ${product.brand}`);
  if (product.categories.length) parts.push(`Categories: ${product.categories.join(', ')}`);
  if (product.material) parts.push(`Material: ${product.material}`);
  if (product.productType) parts.push(`Product Type: ${product.productType}`);

  // Supplement with feed categories if DB categories are sparse
  if (product.categories.length <= 1) {
    if (product.xmlCategories.length > 0) {
      parts.push(`Feed Categories: ${product.xmlCategories.join(', ')}`);
    }
    if (product.stcCategories.length > 0) {
      parts.push(`STC Categories: ${product.stcCategories.join(', ')}`);
    }
  }

  if (Object.keys(product.mergedSpecifications).length > 0) {
    const specLines = Object.entries(product.mergedSpecifications)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    parts.push(`Specifications:\n${specLines}`);
  }

  if (product.mergedFeatures.length > 0) {
    parts.push(`Features: ${product.mergedFeatures.join('; ')}`);
  }

  return parts.join('\n\n');
}

/** Build context for variations to include in parent prompt */
function buildVariationsContext(variations: MergedProduct[]): string {
  if (variations.length === 0) return '';

  const lines: string[] = ['Available Variations:'];
  // Cap at 20 variations to avoid token explosion
  const subset = variations.slice(0, 20);
  for (const v of subset) {
    let line = `- ${v.title}`;
    if (v.mergedDescription) {
      const snippet = v.mergedDescription.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200);
      line += `: ${snippet}`;
    }
    lines.push(line);
  }
  if (variations.length > 20) {
    lines.push(`  ... and ${variations.length - 20} more variations`);
  }
  return lines.join('\n');
}

/** Truncate HTML without cutting mid-tag. Finds last closing tag before limit. */
function safeTruncate(html: string, maxChars: number): string {
  if (html.length <= maxChars) return html;
  // Find the last '>' before maxChars to avoid cutting mid-tag
  const cutpoint = html.lastIndexOf('>', maxChars);
  if (cutpoint > 0) return html.substring(0, cutpoint + 1);
  return html.substring(0, maxChars);
}

const PRESERVE_STRUCTURES_INSTRUCTION =
  '- Preserve any existing <table>, <thead>, <tbody>, <tr>, <td>, <th>, and <ol> tags exactly as they are. Do not convert tables to lists or prose. Do not convert ordered lists to unordered lists.';

function buildEnhancePrompt(
  product: MergedProduct,
  profile: CategoryProfile,
  variations?: MergedProduct[]
): string {
  const context = buildProductContext(product);
  const existingDesc = safeTruncate(product.mergedDescription || '', 6000);
  const variationsCtx = variations ? buildVariationsContext(variations) : '';

  let prompt = `${context}`;
  if (variationsCtx) {
    prompt += `\n\n${variationsCtx}`;
  }

  prompt += `

Existing description to enhance:
---
${existingDesc}
---

Enhance this existing description. Keep the base text and its information mostly intact — do NOT rewrite from scratch.

Your tasks:
- Fix grammar, spelling, and punctuation errors
- Add or improve <h2>/<h3> headings if the structure is weak (suggestions: ${profile.headingSuggestions.slice(0, 3).join(', ')})
- Fill any information gaps using the product data above (specs, features, materials)
- Remove duplicate sentences or repeated information
- Tighten weak or generic phrasing with more specific copy
${PRESERVE_STRUCTURES_INSTRUCTION}
- ${profile.toneGuidance}`;

  if (variationsCtx) {
    prompt += '\n- The product comes in multiple variations. Mention the range of options available (sizes, colors, styles) where natural.';
  }

  prompt += '\n\nOutput ONLY the enhanced HTML. No markdown. No code fences.';
  return prompt;
}

function buildReformatPrompt(
  product: MergedProduct,
  profile: CategoryProfile,
  variations?: MergedProduct[]
): string {
  const context = buildProductContext(product);
  const existingDesc = safeTruncate(product.mergedDescription || '', 4000);
  const variationsCtx = variations ? buildVariationsContext(variations) : '';

  let prompt = `${context}`;
  if (variationsCtx) {
    prompt += `\n\n${variationsCtx}`;
  }

  prompt += `

Existing description to restructure:
---
${existingDesc}
---

Restructure and improve this description into well-organized HTML. You have creative license to reorganize and expand, but build upon the existing text rather than starting from scratch.

Your tasks:
- Break the text into logical sections with <h2>/<h3> headings (suggestions: ${profile.headingSuggestions.slice(0, 3).join(', ')})
- Expand thin sections using the product data above (specs, features, materials)
- Fix grammar, spelling, and punctuation errors
- Remove duplicate sentences or repeated information
${PRESERVE_STRUCTURES_INSTRUCTION}
- ${profile.toneGuidance}
- ${profile.usageAngle}`;

  if (variationsCtx) {
    prompt += '\n- The product comes in multiple variations. Mention the range of options available where natural.';
  }

  prompt += '\n\nOutput ONLY the restructured HTML. No markdown. No code fences.';
  return prompt;
}

function buildGeneratePrompt(
  product: MergedProduct,
  profile: CategoryProfile,
  variant: StructureVariant,
  variations?: MergedProduct[]
): string {
  const context = buildProductContext(product);
  const variationsCtx = variations ? buildVariationsContext(variations) : '';

  // Pick headings from the profile to fill placeholders
  const headings = [...profile.headingSuggestions];
  let structure = variant.template;
  structure = structure.replace(/HEADING_A/g, headings[0] || 'Overview');
  structure = structure.replace(/HEADING_B/g, headings[1] || 'Details');
  structure = structure.replace(/HEADING_C/g, headings[2] || 'More to Know');
  structure = structure.replace(/PRODUCT_NAME/g, product.title);

  let prompt = `${context}`;

  if (variationsCtx) {
    prompt += `\n\n${variationsCtx}`;
  }

  if (product.mergedDescription) {
    const desc = product.mergedDescription.substring(0, 800);
    prompt += `\n\nExisting brief description (use as reference, rewrite and expand):\n${desc}`;
  }

  prompt += `\n\n${structure}`;
  prompt += `\n\n${profile.toneGuidance}`;
  prompt += `\n${profile.usageAngle}`;

  if (variationsCtx) {
    prompt += '\nThe product comes in multiple variations. Mention the range of options available where natural.';
  }

  prompt += `\n\nOutput ONLY the HTML. No markdown. No code fences.`;

  return prompt;
}

function buildVariationPrompt(
  product: MergedProduct,
  parentTitle: string,
  parentHtml?: string
): string {
  const parts: string[] = [];

  parts.push(`Parent product: ${parentTitle}`);
  parts.push(`Variation: ${product.title}`);

  if (product.mergedDescription) {
    parts.push(`Existing variation description:\n${product.mergedDescription.substring(0, 500)}`);
  }

  if (parentHtml) {
    // Give the LLM the parent description so it knows what's covered
    const parentText = parentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500);
    parts.push(`Parent description summary: ${parentText}`);
  }

  parts.push(`Write a brief HTML description (40-80 words) for this product variation.
Focus on what makes THIS variant specific — size, color, style, or feature differences from the base product.
Do not repeat general product information already covered in the parent description.
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
  // Convert markdown lists (but not inside <ol> blocks)
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  // Wrap consecutive <li> in <ul> (only if not already inside <ol>)
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
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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
  let clean = response.replace(/```json?\s*/gi, '').replace(/```\s*/g, '').trim();
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

/**
 * Generate or enhance a product description.
 *
 * @param llm - LLM provider to use
 * @param product - The product to generate a description for
 * @param options.parentTitle - Parent product title (for variations)
 * @param options.parentHtml - Parent's generated HTML (for variations, to avoid repeating info)
 * @param options.variations - Child variations (for parent products, to inform comprehensive parent desc)
 */
export async function generateDescription(
  llm: LLMProvider,
  product: MergedProduct,
  options: {
    parentTitle?: string;
    parentHtml?: string;
    variations?: MergedProduct[];
  } = {}
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
      path: 'skipped',
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
      path: 'skipped',
    };
  }

  try {
    let prompt: string;
    let path: GeneratedDescription['path'];
    let categoryProfile: string | undefined;
    let structureVariant: number | undefined;

    if (isVariation) {
      prompt = buildVariationPrompt(product, options.parentTitle || '', options.parentHtml);
      path = 'variation';
    } else {
      const enrichPath = classifyProduct(product);
      const profile = matchCategoryProfile(product);
      categoryProfile = profile.id;
      path = enrichPath;

      if (enrichPath === 'enhance') {
        prompt = buildEnhancePrompt(product, profile, options.variations);
      } else if (enrichPath === 'reformat') {
        prompt = buildReformatPrompt(product, profile, options.variations);
      } else {
        const variantIdx = product.postId % STRUCTURE_VARIANTS.length;
        const variant = STRUCTURE_VARIANTS[variantIdx];
        structureVariant = variantIdx;
        prompt = buildGeneratePrompt(product, profile, variant, options.variations);
      }
    }

    // Variations need fewer tokens than parents; enhance path needs more for longer text
    const maxTokens = isVariation ? 256 : (path === 'enhance' ? 2048 : 1024);

    let html = await llm.generate(prompt, { system: SYSTEM_PROMPT_V2, temperature: 0.7, maxTokens });
    html = markdownToHtml(html);

    // Validate
    const valid = isVariation ? validateVariationHtml(html) : validateParentHtml(html);

    if (!valid) {
      console.warn(`  ⚠ Validation failed for ${product.postId}, retrying...`);
      html = await llm.generate(prompt, { system: SYSTEM_PROMPT_V2, temperature: 0.5, maxTokens });
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
          path,
          categoryProfile,
          structureVariant,
        };
      }
    }

    const excerpt = extractExcerpt(html);

    // Generate SEO metadata (only for parent products, non-fatal)
    let metaTitle = '';
    let metaDescription = '';
    if (!isVariation) {
      try {
        const seoResponse = await llm.generate(buildSeoPrompt(product), {
          temperature: 0.3,
          maxTokens: 256,
        });
        const seo = parseSeoJson(seoResponse);
        metaTitle = seo.meta_title;
        metaDescription = seo.meta_description;
        if (!metaTitle && !metaDescription) {
          console.warn(`  ⚠ SEO parse returned empty for #${product.postId} (raw: ${seoResponse.substring(0, 100)})`);
        }
      } catch (err: any) {
        console.warn(`  ⚠ SEO generation failed for #${product.postId}: ${err.message}`);
      }
    }

    return {
      html,
      excerpt,
      metaTitle,
      metaDescription,
      status: 'success',
      path,
      categoryProfile,
      structureVariant,
    };
  } catch (err: any) {
    return {
      html: product.existingDescription || '',
      excerpt: product.existingExcerpt || '',
      metaTitle: '',
      metaDescription: '',
      status: 'error',
      error: err.message,
      path: isVariation ? 'variation' : classifyProduct(product),
    };
  }
}
