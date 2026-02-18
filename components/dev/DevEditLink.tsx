'use client';

/**
 * Development-only link to edit content in WordPress admin.
 * Only renders in development mode (NODE_ENV === 'development').
 * wpBaseUrl is passed from the server component so the link points
 * to whichever WordPress instance is currently active (local or prod).
 */

interface DevEditLinkProps {
  type: 'post' | 'product';
  databaseId: number | undefined;
  wpBaseUrl?: string;
}

export default function DevEditLink({ type, databaseId, wpBaseUrl }: DevEditLinkProps) {
  if (process.env.NODE_ENV !== 'development' || !databaseId) {
    return null;
  }

  const base = wpBaseUrl || 'https://wp.maleq.com';
  const isLocal = base.includes('local');
  const editUrl = `${base}/wp-admin/post.php?post=${databaseId}&action=edit`;

  const typeLabels = {
    post: 'Post',
    product: 'Product',
  };

  return (
    <a
      href={editUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 text-white text-sm font-medium rounded-lg shadow-lg transition-colors ${
        isLocal
          ? 'bg-green-600 hover:bg-green-700'
          : 'bg-blue-600 hover:bg-blue-700'
      }`}
      title={`Edit ${typeLabels[type]} in WordPress (${isLocal ? 'Local' : 'Production'})`}
    >
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        />
      </svg>
      Edit {typeLabels[type]} {isLocal ? '(Local)' : '(Prod)'}
    </a>
  );
}
