import { ReactNode } from 'react';

interface FollowUsProps {
  heading: string;
  subtitle?: string;
}

interface Social {
  name: string;
  href: string;
  /** Brand color (inline so it can't be dropped by a stale CSS bundle).
   *  Omit for black/white brands so they follow the theme foreground. */
  color?: string;
  icon: ReactNode;
}

// Brand glyphs (Simple Icons paths), 24×24, drawn with currentColor.
const SOCIALS: Social[] = [
  {
    name: 'Threads',
    href: 'https://www.threads.com/@maleqnews',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.781 3.631 2.695 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L9.06 8.103c.977-1.452 2.564-2.25 4.471-2.25h.043c3.187.02 5.085 1.978 5.275 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.151 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.504-11.838c-.385 0-.776.012-1.173.034-1.836.103-2.977.946-2.911 2.121.062 1.115 1.297 1.634 2.453 1.572 1.062-.057 2.45-.469 2.683-3.232a10.524 10.524 0 0 0-1.052-.495Z" />
      </svg>
    ),
  },
  {
    name: 'Bluesky',
    href: 'https://bsky.app/profile/mqnews.bsky.social',
    color: '#1185FE',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.296 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.479 0-.688-.139-1.86-.902-2.203-.659-.299-1.664-.621-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z" />
      </svg>
    ),
  },
  {
    name: 'Mastodon',
    href: 'https://mastodon.social/@mqnews',
    color: '#6364FF',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M23.268 5.313c-.35-2.578-2.617-4.61-5.304-5.004C17.51.242 15.792 0 11.813 0h-.03c-3.98 0-4.835.242-5.288.309C3.882.692 1.496 2.518.917 5.127.64 6.412.61 7.837.661 9.143c.074 1.874.088 3.745.26 5.611.118 1.24.325 2.47.62 3.68.55 2.237 2.777 4.098 4.96 4.857 2.336.792 4.849.923 7.256.38.265-.061.527-.132.786-.213.585-.184 1.27-.39 1.774-.753a.057.057 0 0 0 .023-.043v-1.809a.052.052 0 0 0-.02-.041.053.053 0 0 0-.046-.01 20.282 20.282 0 0 1-4.709.545c-2.73 0-3.463-1.284-3.674-1.818a5.593 5.593 0 0 1-.319-1.433.053.053 0 0 1 .066-.054c1.517.363 3.072.546 4.632.546.376 0 .75 0 1.125-.01 1.57-.044 3.224-.124 4.768-.422.038-.008.077-.015.11-.024 2.435-.464 4.753-1.92 4.989-5.604.008-.145.03-1.52.03-1.67.002-.512.167-3.63-.024-5.545zm-3.748 9.195h-2.561V8.29c0-1.309-.55-1.976-1.67-1.976-1.23 0-1.846.79-1.846 2.35v3.403h-2.546V8.663c0-1.56-.617-2.35-1.848-2.35-1.112 0-1.668.668-1.67 1.977v6.218H4.822V8.102c0-1.31.337-2.35 1.011-3.12.696-.77 1.608-1.165 2.74-1.165 1.311 0 2.302.504 2.962 1.51l.638 1.07.638-1.07c.66-1.006 1.65-1.51 2.96-1.51 1.13 0 2.043.395 2.74 1.164.675.77 1.012 1.811 1.012 3.121z" />
      </svg>
    ),
  },
  {
    name: 'X',
    href: 'https://x.com/MaleQNews',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    name: 'Facebook',
    href: 'https://www.facebook.com/profile.php?id=61590458556679',
    color: '#1877F2',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
  },
  {
    name: 'Tumblr',
    href: 'https://www.tumblr.com/blog/mqnews',
    color: '#4f6f9c',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M14.563 24c-5.093 0-7.031-3.756-7.031-6.411V9.747H5.116V6.648c3.63-1.313 4.512-4.596 4.71-6.469C9.84.051 9.941 0 9.999 0h3.517v6.114h4.801v3.633h-4.82v7.47c.016 1.001.375 2.371 2.207 2.371h.09c.631-.02 1.486-.205 1.936-.419l1.156 3.425c-.436.636-2.4 1.374-4.156 1.404h-.178z" />
      </svg>
    ),
  },
];

/**
 * "Follow us" block for the news brand's social accounts. Centered heading
 * with a row of bare, brand-colored glyphs that lighten on hover.
 *
 * Colors, icon size, and padding are set via inline styles (not Tailwind
 * utilities) so a stale/service-worker-cached CSS bundle can't drop them.
 * Pure links → server component; heading/subtitle arrive pre-translated.
 */
export default function FollowUs({ heading, subtitle }: FollowUsProps) {
  return (
    <section
      className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-card text-center sm:flex-row sm:justify-between sm:text-left"
      style={{ padding: '2.5rem 1.5rem' }}
    >
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{heading}</h2>
        {subtitle && <p className="mx-auto mt-2 max-w-md text-muted-foreground sm:mx-0">{subtitle}</p>}
      </div>

      <ul
        className="flex flex-shrink-0 flex-wrap items-center justify-center"
        style={{ gap: '2rem' }}
      >
        {SOCIALS.map((social) => (
          <li key={social.name}>
            <a
              href={social.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={social.name}
              title={social.name}
              className={`block transition-opacity duration-200 hover:opacity-60 focus-visible:opacity-60 focus-visible:outline-none ${social.color ? '' : 'text-foreground'}`}
              style={social.color ? { color: social.color } : undefined}
            >
              {social.icon}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
