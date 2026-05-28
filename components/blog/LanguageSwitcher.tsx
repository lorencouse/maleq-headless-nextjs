import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { PostTranslation } from '@/lib/db/post-translations';

interface LanguageSwitcherProps {
  translations: PostTranslation[];
}

/**
 * "Also available in" row shown under a guide title, linking to its versions in
 * other languages. Language is derived from each post's category; links are
 * managed via the post-translations meta box. Renders nothing when a guide has
 * no linked translations.
 */
export default async function LanguageSwitcher({ translations }: LanguageSwitcherProps) {
  if (translations.length === 0) {
    return null;
  }

  const t = await getTranslations('blog');

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t('alsoAvailableIn')}</span>
      {translations.map((t) => (
        <Link
          key={t.postId}
          href={`/guides/${t.slug}`}
          hrefLang={t.hreflang}
          lang={t.hreflang}
          title={t.title}
          className="inline-flex items-center rounded-full bg-input px-3 py-1 font-medium leading-none text-foreground transition-colors hover:bg-border"
        >
          {t.nativeLabel}
        </Link>
      ))}
    </div>
  );
}
