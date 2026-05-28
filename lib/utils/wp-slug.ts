/**
 * Normalize a route slug to the form WordPress stores in `wp_posts.post_name`.
 *
 * Non-ASCII guide slugs (Chinese/Japanese) are stored percent-encoded and
 * LOWERCASE, e.g. `%e6%9c%80%e6%8e%a8...-3`. Next.js, however, hands the
 * dynamic `[slug]` param to the page percent-encoded but UPPERCASE
 * (`%E6%9C%80...`) — RFC 3986 normalization — and never decodes the CJK
 * bytes. That uppercase form matches neither the SQL `post_name` nor WPGraphQL
 * `postBy(slug:)`, so every CJK guide 404s.
 *
 * Decoding then re-encoding and lowercasing reconstructs WP's exact stored
 * value, and it round-trips both inputs Next can produce (uppercase-encoded OR
 * already-decoded) as well as plain ASCII slugs (a no-op for those). WPGraphQL
 * `postBy` matches this lowercase-encoded form, and so does a direct
 * `post_name` SQL lookup. Falls back to the raw slug if decoding throws on a
 * malformed sequence.
 */
export function toWpPostName(slug: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(slug)).toLowerCase();
  } catch {
    return slug.toLowerCase();
  }
}
