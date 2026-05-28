import Link from 'next/link';
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
export default function LanguageSwitcher({ translations }: LanguageSwitcherProps) {
  if (translations.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Also available in:</span>
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
