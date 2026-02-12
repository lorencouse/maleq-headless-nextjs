'use client';

export default function CategoryError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <h1>Category Page Error</h1>
      <pre style={{ whiteSpace: 'pre-wrap', background: '#f0f0f0', padding: '1rem' }}>
        {error.message}
      </pre>
      <pre style={{ whiteSpace: 'pre-wrap', background: '#fff0f0', padding: '1rem', fontSize: '12px' }}>
        {error.stack}
      </pre>
      {error.digest && <p>Digest: {error.digest}</p>}
    </div>
  );
}
