'use client';

import { useState } from 'react';

interface RawDataDebugProps {
  data: any;
  title?: string;
}

export default function RawDataDebug({ data, title = 'Raw API Data' }: RawDataDebugProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!data) return null;

  return (
    <div className="border-t border-gray-200 pt-8 mt-8">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full text-left mb-4 hover:text-blue-600 transition-colors"
      >
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <svg
          className={`w-5 h-5 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="bg-gray-900 text-green-400 rounded-lg p-4 overflow-x-auto">
          <pre className="text-sm font-mono whitespace-pre-wrap">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
