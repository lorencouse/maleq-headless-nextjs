'use client';

import { useState, useEffect } from 'react';

interface PriceRangeFilterProps {
  minPrice: number;
  maxPrice: number;
  onPriceChange: (min: number, max: number) => void;
}

export default function PriceRangeFilter({
  minPrice,
  maxPrice,
  onPriceChange,
}: PriceRangeFilterProps) {
  const [localMin, setLocalMin] = useState(minPrice > 0 ? minPrice.toString() : '');
  const [localMax, setLocalMax] = useState(maxPrice > 0 ? maxPrice.toString() : '');

  useEffect(() => {
    setLocalMin(minPrice > 0 ? minPrice.toString() : '');
    setLocalMax(maxPrice > 0 ? maxPrice.toString() : '');
  }, [minPrice, maxPrice]);

  const handleBlur = () => {
    const minVal = Math.max(0, parseInt(localMin) || 0);
    const maxVal = localMax === '' ? 0 : Math.max(0, parseInt(localMax) || 0);

    // maxVal of 0 means "no max"
    if (maxVal === 0 || minVal <= maxVal) {
      onPriceChange(minVal, maxVal);
    } else {
      // Reset to current values if invalid
      setLocalMin(minPrice > 0 ? minPrice.toString() : '');
      setLocalMax(maxPrice > 0 ? maxPrice.toString() : '');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleBlur();
    }
  };

  const presetRanges = [
    { label: 'Under $25', min: 0, max: 25 },
    { label: '$25 - $50', min: 25, max: 50 },
    { label: '$50 - $100', min: 50, max: 100 },
    { label: '$100 - $200', min: 100, max: 200 },
    { label: '$200 - $500', min: 200, max: 500 },
    { label: '$500 - $1000', min: 500, max: 1000 },
    { label: 'Over $1000', min: 1000, max: 0 },
  ];

  return (
    <div className="pt-3 space-y-4">
      {/* Input Fields */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="sr-only">Minimum price</label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">$</span>
            <input
              type="number"
              value={localMin}
              onChange={(e) => setLocalMin(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              min={0}
              placeholder="Min"
              className="w-full pl-6 pr-2 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>
        <span className="text-muted-foreground text-sm">to</span>
        <div className="flex-1">
          <label className="sr-only">Maximum price</label>
          <div className="relative">
            <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none ${localMax === '' ? 'hidden' : ''}`}>$</span>
            <input
              type="number"
              value={localMax}
              onChange={(e) => setLocalMax(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              min={0}
              placeholder="No Max"
              className={`w-full pr-2 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder:text-muted-foreground/60 ${localMax === '' ? 'pl-2.5' : 'pl-6'}`}
            />
          </div>
        </div>
      </div>

      {/* Preset Ranges */}
      <div className="space-y-1">
        {presetRanges.map((range) => (
          <button
            key={range.label}
            onClick={() => onPriceChange(range.min, range.max)}
            className={`block w-full text-left px-3 py-1.5 text-sm rounded-lg transition-colors ${
              minPrice === range.min && maxPrice === range.max
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {range.label}
          </button>
        ))}
      </div>
    </div>
  );
}
