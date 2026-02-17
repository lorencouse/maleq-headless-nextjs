/**
 * Description Generator V2
 *
 * Two-path architecture:
 *  - Reformat: existing description >= 300 chars → restructure, don't rewrite
 *  - Generate: short/no description → fresh content with varied templates
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
  path: 'reformat' | 'generate' | 'variation' | 'skipped';
  categoryProfile?: string;
  structureVariant?: number;
}

type EnrichmentPath = 'reformat' | 'generate';

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

const REFORMAT_CHAR_THRESHOLD = 300;

/** Strip HTML tags and return plain-text length */
function plainTextLength(html: string): number {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
}

export function classifyProduct(product: MergedProduct): EnrichmentPath {
  const descLength = plainTextLength(product.mergedDescription || '');
  return descLength >= REFORMAT_CHAR_THRESHOLD ? 'reformat' : 'generate';
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

function buildReformatPrompt(product: MergedProduct, profile: CategoryProfile): string {
  const context = buildProductContext(product);
  const existingDesc = (product.mergedDescription || '').substring(0, 2500);

  return `${context}

Existing description to reformat:
---
${existingDesc}
---

Reformat this existing description into structured HTML. Do NOT rewrite it from scratch — preserve the original wording and information.

Your tasks:
- Break the text into logical paragraphs with <p> tags
- Add 2–3 <h2>/<h3> headings to organize sections (suggestions: ${profile.headingSuggestions.slice(0, 3).join(', ')})
- Fix grammar, spelling, and punctuation errors
- Remove duplicate sentences or repeated information
- If specifications are mentioned inline, consider grouping them under a short heading
- Keep the original tone and content. Do not add information that isn't in the source text.
- ${profile.toneGuidance}

Output ONLY the reformatted HTML. No markdown. No code fences.`;
}

function buildGeneratePrompt(product: MergedProduct, profile: CategoryProfile, variant: StructureVariant): string {
  const context = buildProductContext(product);

  // Pick headings from the profile to fill placeholders
  const headings = [...profile.headingSuggestions];
  let structure = variant.template;
  structure = structure.replace(/HEADING_A/g, headings[0] || 'Overview');
  structure = structure.replace(/HEADING_B/g, headings[1] || 'Details');
  structure = structure.replace(/HEADING_C/g, headings[2] || 'More to Know');
  structure = structure.replace(/PRODUCT_NAME/g, product.title);

  let prompt = `${context}`;

  if (product.mergedDescription) {
    const desc = product.mergedDescription.substring(0, 800);
    prompt += `\n\nExisting brief description (use as reference, rewrite and expand):\n${desc}`;
  }

  prompt += `\n\n${structure}`;
  prompt += `\n\n${profile.toneGuidance}`;
  prompt += `\n${profile.usageAngle}`;
  prompt += `\n\nOutput ONLY the HTML. No markdown. No code fences.`;

  return prompt;
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
      prompt = buildVariationPrompt(product, parentTitle || '');
      path = 'variation';
    } else {
      const enrichPath = classifyProduct(product);
      const profile = matchCategoryProfile(product);
      categoryProfile = profile.id;
      path = enrichPath;

      if (enrichPath === 'reformat') {
        prompt = buildReformatPrompt(product, profile);
      } else {
        const variantIdx = product.postId % STRUCTURE_VARIANTS.length;
        const variant = STRUCTURE_VARIANTS[variantIdx];
        structureVariant = variantIdx;
        prompt = buildGeneratePrompt(product, profile, variant);
      }
    }

    // Variations need fewer tokens than parents
    const maxTokens = isVariation ? 256 : 1024;

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
