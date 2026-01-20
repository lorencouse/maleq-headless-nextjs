'use client';

import { useState, useEffect } from 'react';

interface PriceRangeFilterProps {
  minPrice: number;
  maxPrice: number;
  onPriceChange: (min: number, max: number) => void;
  min?: number;
  max?: number;
}

export default function PriceRangeFilter({
  minPrice,
  maxPrice,
  onPriceChange,
  min = 0,
  max = 500,
}: PriceRangeFilterProps) {
  const [localMin, setLocalMin] = useState(minPrice.toString());
  const [localMax, setLocalMax] = useState(maxPrice.toString());

  useEffect(() => {
    setLocalMin(minPrice.toString());
    setLocalMax(maxPrice.toString());
  }, [minPrice, maxPrice]);

  const handleMinChange = (value: string) => {
    setLocalMin(value);
  };

  const handleMaxChange = (value: string) => {
    setLocalMax(value);
  };

  const handleBlur = () => {
    const minVal = Math.max(min, parseInt(localMin) || min);
    const maxVal = Math.min(max, parseInt(localMax) || max);

    if (minVal <= maxVal) {
      onPriceChange(minVal, maxVal);
    } else {
      // Reset to current values if invalid
      setLocalMin(minPrice.toString());
      setLocalMax(maxPrice.toString());
    }
  };

  const presetRanges = [
    { label: 'Under $25', min: 0, max: 25 },
    { label: '$25 - $50', min: 25, max: 50 },
    { label: '$50 - $100', min: 50, max: 100 },
    { label: '$100 - $200', min: 100, max: 200 },
    { label: 'Over $200', min: 200, max: 500 },
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
              onChange={(e) => handleMinChange(e.target.value)}
              onBlur={handleBlur}
              min={min}
              max={max}
              placeholder="Min"
              className="w-full pl-6 pr-2 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>
        <span className="text-muted-foreground text-sm">to</span>
        <div className="flex-1">
          <label className="sr-only">Maximum price</label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">$</span>
            <input
              type="number"
              value={localMax}
              onChange={(e) => handleMaxChange(e.target.value)}
              onBlur={handleBlur}
              min={min}
              max={max}
              placeholder="Max"
              className="w-full pl-6 pr-2 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>
      </div>

      {/* Preset Ranges */}
      <div className="space-y-2">
        {presetRanges.map((range) => (
          <button
            key={range.label}
            onClick={() => onPriceChange(range.min, range.max)}
            className={`block w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
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
