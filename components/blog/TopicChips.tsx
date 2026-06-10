import Link from 'next/link';

interface TopicChipsProps {
  topics: { name: string; slug: string }[];
  /** Optional leading label, e.g. "Explore topics". */
  label?: string;
}

/**
 * Horizontal row of pill links to the top news tags. Pure links, so this stays
 * a server component. Best wayfinding affordance on the page.
 */
export default function TopicChips({ topics, label }: TopicChipsProps) {
  if (topics.length === 0) return null;

  return (
    <nav className="flex flex-wrap items-center gap-2">
      {label && (
        <span className="mr-1 text-sm font-semibold text-muted-foreground">{label}</span>
      )}
      {topics.map((topic) => (
        <Link
          key={topic.slug}
          href={`/guides/tag/${topic.slug}`}
          className="inline-flex items-center rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium leading-none text-foreground transition-colors hover:border-primary hover:text-primary"
        >
          {topic.name}
        </Link>
      ))}
    </nav>
  );
}
