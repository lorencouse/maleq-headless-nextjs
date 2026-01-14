'use client';

import { useState } from 'react';

interface VariationGroup {
  baseName: string;
  baseSkuPattern: string;
  productCount: number;
  products: Array<{
    id: string;
    sku: string;
    name: string;
    price: string | null;
    stockStatus: string;
  }>;
  attributes: Array<{
    name: string;
    values: string[];
  }>;
}

export default function VariationsPage() {
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [groups, setGroups] = useState<VariationGroup[]>([]);
  const [mergeResult, setMergeResult] = useState<{
    groupsFound: number;
    groupsMerged: number;
    productsAffected: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detectVariations = async () => {
    setDetecting(true);
    setError(null);
    setMergeResult(null);

    try {
      const response = await fetch('/api/admin/variations/detect');
      const data = await response.json();

      if (data.success) {
        setGroups(data.groups);
      } else {
        setError(data.error || 'Failed to detect variations');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setDetecting(false);
    }
  };

  const mergeVariations = async () => {
    if (!confirm('This will merge all detected variations. Continue?')) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/variations/merge', {
        method: 'POST',
      });
      const data = await response.json();

      if (data.success) {
        setMergeResult({
          groupsFound: data.groupsFound,
          groupsMerged: data.groupsMerged,
          productsAffected: data.productsAffected,
        });
        // Clear the groups after successful merge
        setGroups([]);
      } else {
        setError(data.error || 'Failed to merge variations');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-6">Product Variation Manager</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h2 className="font-semibold mb-2">How It Works</h2>
        <p className="text-sm text-gray-700 mb-2">
          This tool automatically detects products that are variations of the same base product
          (e.g., different sizes, colors, or counts) and merges them into variable products.
        </p>
        <p className="text-sm text-gray-700">
          Detection is based on:
        </p>
        <ul className="text-sm text-gray-700 list-disc list-inside ml-4">
          <li>Similar product names (with size/volume differences)</li>
          <li>Similar SKU patterns (e.g., EPG02, EPG04, EPG08)</li>
          <li>Same manufacturer and product type</li>
          <li>Detected variation attributes (size, color, count, etc.)</li>
        </ul>
      </div>

      <div className="flex gap-4 mb-6">
        <button
          onClick={detectVariations}
          disabled={detecting || loading}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {detecting ? 'Detecting...' : 'Detect Variations'}
        </button>

        {groups.length > 0 && (
          <button
            onClick={mergeVariations}
            disabled={loading || detecting}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? 'Merging...' : `Merge ${groups.length} Groups`}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-800 font-semibold">Error:</p>
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {mergeResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <p className="text-green-800 font-semibold">Success!</p>
          <p className="text-green-700">
            Found {mergeResult.groupsFound} variation groups, successfully merged{' '}
            {mergeResult.groupsMerged} groups affecting {mergeResult.productsAffected} products.
          </p>
        </div>
      )}

      {groups.length > 0 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold">
            Detected Variation Groups ({groups.length})
          </h2>

          {groups.map((group, groupIndex) => (
            <div key={groupIndex} className="border rounded-lg p-6 bg-white shadow-sm">
              <h3 className="text-xl font-semibold mb-2">{group.baseName}</h3>
              <p className="text-sm text-gray-600 mb-3">
                SKU Pattern: <span className="font-mono">{group.baseSkuPattern}*</span> •{' '}
                {group.productCount} variations
              </p>

              <div className="mb-4">
                <h4 className="font-semibold text-sm mb-2">Detected Attributes:</h4>
                <div className="flex flex-wrap gap-2">
                  {group.attributes.map((attr, attrIndex) => (
                    <div
                      key={attrIndex}
                      className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm"
                    >
                      <span className="font-semibold">{attr.name}:</span>{' '}
                      {attr.values.join(', ')}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Products:</h4>
                {group.products.map((product, prodIndex) => (
                  <div
                    key={product.id}
                    className={`flex items-center justify-between p-3 rounded ${
                      prodIndex === 0
                        ? 'bg-green-50 border border-green-200'
                        : 'bg-gray-50'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="font-mono text-sm font-semibold">
                        {product.sku}
                        {prodIndex === 0 && (
                          <span className="ml-2 text-xs bg-green-600 text-white px-2 py-0.5 rounded">
                            PARENT
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-700">{product.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">
                        {product.price ? `$${product.price}` : 'N/A'}
                      </div>
                      <div
                        className={`text-xs ${
                          product.stockStatus === 'IN_STOCK'
                            ? 'text-green-600'
                            : 'text-red-600'
                        }`}
                      >
                        {product.stockStatus}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!detecting && !loading && groups.length === 0 && !mergeResult && (
        <div className="text-center py-12 text-gray-500">
          Click "Detect Variations" to scan your products for variation groups.
        </div>
      )}
    </div>
  );
}
