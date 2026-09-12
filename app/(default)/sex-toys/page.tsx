import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { getHierarchicalCategories, type HierarchicalCategory } from '@/lib/products/combined-service';
import { loadHierarchicalCategories } from '@/lib/db/category-loader';
import { isMySQLConfigured } from '@/lib/db/pool';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import CategoryCard from '@/components/shop/CategoryCard';
import { BreadcrumbSchema } from '@/components/seo/StructuredData';

/**
 * /sex-toys — the category hub.
 *
 * Until 2026-09 this URL was a 404 even though every product and category
 * breadcrumb (and the /product-tag/* redirects) pointed at it. It now lists
 * the whole category tree as plain links, giving crawlers one hop from any
 * page to every category (SEO audit findings C4 + H1).
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

// Category counts move slowly; hourly ISR is plenty and keeps the hub cheap.
export const revalidate = 3600;

async function getCategories(): Promise<HierarchicalCategory[]> {
  if (isMySQLConfigured() && process.env.DATA_SOURCE !== 'graphql') {
    try {
      return await loadHierarchicalCategories();
    } catch (err) {
      console.error('[sex-toys] MySQL categories failed, falling back to GraphQL:', err);
    }
  }
  return getHierarchicalCategories();
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'categoryIndex' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical: '/sex-toys' },
  };
}

function countAll(cats: HierarchicalCategory[]): number {
  return cats.reduce((n, c) => n + c.count, 0);
}

function CategoryTree({
  categories,
  depth,
  productCount,
}: {
  categories: HierarchicalCategory[];
  depth: number;
  productCount: (count: number) => string;
}) {
  const visible = categories.filter((c) => c.count > 0);
  if (visible.length === 0) return null;
  return (
    <ul className={depth === 0 ? 'space-y-1' : 'mt-1 ml-4 space-y-1 border-l border-border pl-3'}>
      {visible.map((cat) => (
        <li key={cat.slug}>
          <Link
            href={`/sex-toys/${cat.slug}`}
            className={
              depth === 0
                ? 'inline-block py-1 text-sm font-medium text-foreground hover:text-primary transition-colors'
                : 'inline-block py-0.5 text-sm text-muted-foreground hover:text-primary transition-colors'
            }
          >
            {cat.name}
          </Link>
          <span className="ml-2 text-xs text-muted-foreground/70">{productCount(cat.count)}</span>
          {cat.children?.length > 0 && (
            <CategoryTree categories={cat.children} depth={depth + 1} productCount={productCount} />
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function CategoryIndexPage() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'categoryIndex' });
  const ts = await getTranslations({ locale, namespace: 'shopPage' });
  const tf = await getTranslations({ locale, namespace: 'footer' });

  const categories = (await getCategories()).filter((c) => c.count > 0);
  const topLevel = [...categories].sort((a, b) => b.count - a.count);
  const productCount = (count: number) => t('productCount', { count });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
      <BreadcrumbSchema
        items={[
          { name: ts('breadcrumbHome'), url: SITE_URL },
          { name: ts('breadcrumbSexToys'), url: `${SITE_URL}/sex-toys` },
        ]}
      />
      <Breadcrumbs
        items={[
          { label: 'Shop', labelKey: 'productSlugPage.breadcrumbShop', href: '/shop' },
          { label: t('breadcrumb') },
        ]}
      />

      <div className="mt-6 mb-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-2">{t('h1')}</h1>
        <p className="text-lg text-muted-foreground max-w-2xl">{t('subtitle')}</p>
        <p className="text-sm text-muted-foreground mt-2">{productCount(countAll(topLevel))}</p>
      </div>

      {/* Visual grid of the top-level families */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6 mb-14">
        {topLevel.slice(0, 12).map((cat) => (
          <CategoryCard key={cat.slug} category={cat} />
        ))}
      </div>

      {/* Full crawlable index of every category and subcategory */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-10 gap-y-10">
        {topLevel.map((cat) => (
          <section key={cat.slug} aria-labelledby={`cat-${cat.slug}`}>
            <h2 id={`cat-${cat.slug}`} className="text-xl font-bold text-foreground mb-3">
              <Link href={`/sex-toys/${cat.slug}`} className="hover:text-primary transition-colors">
                {cat.name}
              </Link>
              <span className="ml-2 text-sm font-normal text-muted-foreground">{productCount(cat.count)}</span>
            </h2>
            {cat.children?.length > 0 ? (
              <CategoryTree categories={cat.children} depth={0} productCount={productCount} />
            ) : null}
          </section>
        ))}
      </div>

      <div className="mt-14 pt-8 border-t border-border">
        <Link href="/brands" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-hover transition-colors">
          {tf('allBrands')} &rarr;
        </Link>
      </div>
    </div>
  );
}
