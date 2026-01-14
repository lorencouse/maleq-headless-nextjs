'use client';

import { useState } from 'react';

export default function SyncPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const runSync = async (endpoint: string, label: string) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`/api/admin/sync/${endpoint}`, {
        method: 'POST',
      });

      const data = await response.json();

      if (data.success) {
        setResult({ label, data: data.data });
      } else {
        setError(data.error || 'Sync failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '2rem' }}>Williams Trading Sync Dashboard</h1>

      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Quick Actions</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button
            onClick={() => runSync('test', 'Test Sync (10 Products)')}
            disabled={loading}
            style={{
              padding: '1rem',
              fontSize: '1rem',
              backgroundColor: '#ff6b6b',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              fontWeight: 'bold',
            }}
          >
            {loading ? 'Syncing...' : '🧪 Test Sync - 10 Products Only (Recommended First!)'}
          </button>

          <button
            onClick={() => runSync('full', 'Full Sync')}
            disabled={loading}
            style={{
              padding: '1rem',
              fontSize: '1rem',
              backgroundColor: '#0070f3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Syncing...' : 'Run Full Sync (Manufacturers + Types + Products + Images)'}
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <button
              onClick={() => runSync('manufacturers', 'Manufacturers Sync')}
              disabled={loading}
              style={{
                padding: '0.75rem',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              Sync Manufacturers
            </button>

            <button
              onClick={() => runSync('product-types', 'Product Types Sync')}
              disabled={loading}
              style={{
                padding: '0.75rem',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              Sync Product Types
            </button>

            <button
              onClick={() => runSync('products', 'Products Sync')}
              disabled={loading}
              style={{
                padding: '0.75rem',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              Sync Products
            </button>

            <button
              onClick={() => runSync('images', 'Images Sync')}
              disabled={loading}
              style={{
                padding: '0.75rem',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              Sync Images
            </button>
          </div>

          <button
            onClick={() => runSync('stock', 'Stock Update')}
            disabled={loading}
            style={{
              padding: '0.75rem',
              backgroundColor: '#ffc107',
              color: 'black',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            Update Stock Only (Quick)
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#f8d7da',
            color: '#721c24',
            borderRadius: '4px',
            marginBottom: '1rem',
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#d4edda',
            color: '#155724',
            borderRadius: '4px',
          }}
        >
          <h3 style={{ marginTop: 0 }}>{result.label} Completed!</h3>
          <pre style={{
            backgroundColor: '#fff',
            padding: '1rem',
            borderRadius: '4px',
            overflow: 'auto',
            fontSize: '0.875rem'
          }}>
            {JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      )}

      <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
        <h3>Instructions:</h3>
        <ol>
          <li><strong>Test Sync (Recommended First!)</strong> - Syncs 10 products only to verify everything works</li>
          <li><strong>Full Sync</strong> - Run this to import all data (manufacturers, types, products, images)</li>
          <li><strong>Individual Syncs</strong> - Use these to sync specific data types</li>
          <li><strong>Stock Update</strong> - Quick update of stock quantities only (use for scheduled updates)</li>
        </ol>

        <h3 style={{ marginTop: '1.5rem' }}>Notes:</h3>
        <ul>
          <li>Full sync may take several minutes depending on catalog size</li>
          <li>Products sync requires manufacturers and product types to exist first</li>
          <li>Images sync requires products to exist first</li>
          <li>Stock updates are faster and can be run hourly/daily</li>
        </ul>
      </div>
    </div>
  );
}
