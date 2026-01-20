'use client';

import { useState, useEffect } from 'react';

interface RangeFilterProps {
  minValue: number;
  maxValue: number;
  onRangeChange: (min: number, max: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  presets?: Array<{ label: string; min: number; max: number }>;
}

export default function RangeFilter({
  minValue,
  maxValue,
  onRangeChange,
  min = 0,
  max = 100,
  step = 0.5,
  unit = '"',
  presets,
}: RangeFilterProps) {
  const [localMin, setLocalMin] = useState(minValue > 0 ? minValue.toString() : '');
  const [localMax, setLocalMax] = useState(maxValue < max ? maxValue.toString() : '');

  useEffect(() => {
    setLocalMin(minValue > 0 ? minValue.toString() : '');
    setLocalMax(maxValue < max ? maxValue.toString() : '');
  }, [minValue, maxValue, max]);

  const handleMinChange = (value: string) => {
    setLocalMin(value);
  };

  const handleMaxChange = (value: string) => {
    setLocalMax(value);
  };

  const handleBlur = () => {
    const minVal = localMin ? Math.max(min, parseFloat(localMin)) : 0;
    const maxVal = localMax ? Math.min(max, parseFloat(localMax)) : max;

    if (minVal <= maxVal || (!localMin && !localMax)) {
      onRangeChange(minVal, maxVal);
    } else {
      // Reset to current values if invalid
      setLocalMin(minValue > 0 ? minValue.toString() : '');
      setLocalMax(maxValue < max ? maxValue.toString() : '');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur();
    }
  };

  const isPresetActive = (preset: { min: number; max: number }) => {
    return minValue === preset.min && maxValue === preset.max;
  };

  return (
    <div className="pt-3 space-y-4">
      {/* Input Fields */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="sr-only">Minimum</label>
          <div className="relative">
            <input
              type="number"
              value={localMin}
              onChange={(e) => handleMinChange(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              min={min}
              max={max}
              step={step}
              placeholder="Min"
              className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder:text-muted-foreground/60"
            />
            {unit && (
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">
                {unit}
              </span>
            )}
          </div>
        </div>
        <span className="text-muted-foreground text-sm">to</span>
        <div className="flex-1">
          <label className="sr-only">Maximum</label>
          <div className="relative">
            <input
              type="number"
              value={localMax}
              onChange={(e) => handleMaxChange(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              min={min}
              max={max}
              step={step}
              placeholder="Max"
              className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder:text-muted-foreground/60"
            />
            {unit && (
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">
                {unit}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Preset Ranges */}
      {presets && presets.length > 0 && (
        <div className="space-y-2">
          {presets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => onRangeChange(preset.min, preset.max)}
              className={`block w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                isPresetActive(preset)
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
