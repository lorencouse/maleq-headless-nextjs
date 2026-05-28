import type Anthropic from '@anthropic-ai/sdk';
import { queryProductIndex } from '@/lib/products/product-index';
import { searchBlogPosts } from '@/lib/blog/blog-service';
import { loadPostRecommendations } from '@/lib/db/post-relations';

function slugify(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const s = input.trim().toLowerCase().replace(/\s+/g, '-');
  return s.length > 0 ? s : undefined;
}

function num(input: unknown): number | undefined {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string' && input.trim() !== '') {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function bool(input: unknown): boolean | undefined {
  if (typeof input === 'boolean') return input;
  return undefined;
}

export const productSearchTool: Anthropic.Tool = {
  name: 'search_products',
  description:
    'Search the Male Q product catalog by concrete criteria — name, type, material, color, brand, price range, or sale status. Returns up to 6 matching products with name, price, brand, material, stock status, and a product URL. Pass simple natural terms (e.g. "silicone", "black", "lelo") — the system will normalize them. For open-ended advice ("what\'s the best…", "what do you recommend for…"), prefer find_buying_guides, which returns our editorial picks; use search_products for specific filtered lookups or catalog browsing.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Free-text search across product names. Use the customer\'s own keywords (e.g. "rabbit vibrator", "leather harness"). Leave empty if filtering by brand/material/category alone.',
      },
      brand: {
        type: 'string',
        description: 'Brand name (e.g. "Lelo", "We-Vibe"). Case-insensitive.',
      },
      material: {
        type: 'string',
        description: 'Material (e.g. "silicone", "glass", "metal", "leather").',
      },
      color: {
        type: 'string',
        description: 'Color (e.g. "black", "pink", "purple").',
      },
      category: {
        type: 'string',
        description:
          'Category slug if known (e.g. "vibrators", "dildos", "harnesses"). Often easier to just use `query`.',
      },
      min_price: {
        type: 'number',
        description: 'Minimum price in USD.',
      },
      max_price: {
        type: 'number',
        description: 'Maximum price in USD.',
      },
      on_sale: {
        type: 'boolean',
        description: 'If true, only return products currently on sale.',
      },
      in_stock_only: {
        type: 'boolean',
        description:
          'If true (recommended), only return products currently in stock. Default true.',
      },
      sort: {
        type: 'string',
        enum: ['relevance', 'price_low_to_high', 'price_high_to_low', 'popular', 'newest'],
        description: 'How to sort results. Use "popular" for general recommendations, "price_low_to_high" when the customer wants cheap options.',
      },
    },
  },
};

type ToolResultProduct = {
  name: string;
  url: string;
  price_usd: number | null;
  on_sale: boolean;
  brand: string | null;
  material: string | null;
  in_stock: boolean;
  rating: number | null;
  review_count: number;
};

type ToolResult =
  | { ok: true; total_matches: number; returned: number; products: ToolResultProduct[] }
  | { ok: false; error: string };

const SORT_MAP: Record<string, string> = {
  relevance: 'newest',
  price_low_to_high: 'price-asc',
  price_high_to_low: 'price-desc',
  popular: 'popularity',
  newest: 'newest',
};

export async function executeProductSearch(input: unknown): Promise<ToolResult> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Invalid tool input.' };
  }
  const raw = input as Record<string, unknown>;

  const minPrice = num(raw.min_price);
  const maxPrice = num(raw.max_price);
  const onSale = bool(raw.on_sale);
  const inStockRaw = bool(raw.in_stock_only);
  const inStock = inStockRaw === undefined ? true : inStockRaw;
  const sortKey = typeof raw.sort === 'string' ? SORT_MAP[raw.sort] ?? 'newest' : 'newest';

  const search = typeof raw.query === 'string' && raw.query.trim() ? raw.query.trim() : undefined;
  const brand = slugify(raw.brand);
  const material = slugify(raw.material);
  const color = slugify(raw.color);
  const category = slugify(raw.category);

  try {
    const { products, total } = await queryProductIndex({
      search,
      brand,
      material,
      color,
      category,
      minPrice,
      maxPrice,
      onSale,
      inStock,
      sort: sortKey,
      limit: 6,
    });

    const formatted: ToolResultProduct[] = products.map((p) => ({
      name: p.name,
      url: `/product/${p.slug}`,
      price_usd: p.price,
      on_sale: p.onSale,
      brand: p.brandName,
      material: p.materialName,
      in_stock: p.stockStatus === 'IN_STOCK',
      rating: p.averageRating > 0 ? Number(p.averageRating.toFixed(1)) : null,
      review_count: p.reviewCount,
    }));

    return {
      ok: true,
      total_matches: total,
      returned: formatted.length,
      products: formatted,
    };
  } catch (err) {
    console.error('[chatbot] product search failed:', err);
    return { ok: false, error: 'Product search failed.' };
  }
}

// ─── Buying-guide recommendations (our editorial picks) ───

export const guideRecommendationTool: Anthropic.Tool = {
  name: 'find_buying_guides',
  description:
    "Find Male Q's own buying guides/articles for a topic AND the products we personally recommend in them. Use this for recommendation or advice questions — \"what's the best …\", \"what do you recommend for …\", \"which … should I get\", \"help me choose …\". Returns up to 3 relevant guides, each with the article URL, a short excerpt, the hand-picked products we feature in that guide, and the product categories we link from it. PREFER this over search_products for recommendation-style questions: it reflects our editorial picks, not just raw catalog matches. Use search_products instead when the customer gives concrete catalog filters (specific brand, material, color, price range).",
  input_schema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description:
          'The subject the customer wants advice on, in their own words (e.g. "anal lube", "beginner vibrator", "prostate massager", "cock ring for harder erections").',
      },
    },
    required: ['topic'],
  },
};

type GuideRecResult =
  | {
      ok: true;
      guides: {
        title: string;
        url: string;
        excerpt: string | null;
        recommended_products: { name: string; url: string; price_usd: number | null; in_stock: boolean }[];
        related_categories: { name: string; url: string }[];
      }[];
    }
  | { ok: false; error: string };

function priceToNumber(price: string | null): number | null {
  if (!price) return null;
  const m = price.match(/[\d.]+/);
  return m ? Number(m[0]) || null : null;
}

function toExcerpt(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 160) : null;
}

export async function executeGuideRecommendation(input: unknown): Promise<GuideRecResult> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Invalid tool input.' };
  }
  const topic = typeof (input as Record<string, unknown>).topic === 'string'
    ? ((input as Record<string, unknown>).topic as string).trim()
    : '';
  if (!topic) return { ok: false, error: 'A topic is required.' };

  try {
    const { posts } = await searchBlogPosts(topic, { first: 4 });

    const guides = await Promise.all(
      posts.slice(0, 4).map(async (post) => {
        const rec = await loadPostRecommendations(post.databaseId);
        return {
          title: post.title,
          url: `/guides/${post.slug}`,
          excerpt: toExcerpt(post.excerpt),
          recommended_products: rec.products.slice(0, 6).map((p) => ({
            name: p.name,
            url: `/product/${p.slug}`,
            price_usd: priceToNumber(p.price),
            in_stock: p.stockStatus === 'IN_STOCK',
          })),
          related_categories: rec.categories.map((c) => ({
            name: c.name,
            url: `/shop?category=${c.slug}`,
          })),
        };
      }),
    );

    // Surface guides that actually have curated picks first.
    guides.sort(
      (a, b) =>
        b.recommended_products.length - a.recommended_products.length ||
        b.related_categories.length - a.related_categories.length,
    );

    return { ok: true, guides: guides.slice(0, 3) };
  } catch (err) {
    console.error('[chatbot] guide recommendation failed:', err);
    return { ok: false, error: 'Guide lookup failed.' };
  }
}

export const chatbotTools: Anthropic.Tool[] = [productSearchTool, guideRecommendationTool];

export async function executeTool(
  name: string,
  input: unknown
): Promise<{ content: string; isError: boolean }> {
  switch (name) {
    case 'search_products': {
      const result = await executeProductSearch(input);
      return {
        content: JSON.stringify(result),
        isError: !result.ok,
      };
    }
    case 'find_buying_guides': {
      const result = await executeGuideRecommendation(input);
      return {
        content: JSON.stringify(result),
        isError: !result.ok,
      };
    }
    default:
      return {
        content: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }),
        isError: true,
      };
  }
}
