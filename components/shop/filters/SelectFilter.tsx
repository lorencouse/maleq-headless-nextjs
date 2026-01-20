'use client';

import type { FilterOption } from '@/lib/products/combined-service';

// Re-export for convenience
export type { FilterOption };

interface SelectFilterProps {
  options: FilterOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
  placeholder?: string;
}

export default function SelectFilter({
  options,
  selectedValue,
  onSelect,
  placeholder = 'All',
}: SelectFilterProps) {
  // Filter out options with no products
  const validOptions = options.filter(opt => opt.count && opt.count > 0);

  if (validOptions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">No options available</p>
    );
  }

  return (
    <div className="mt-2">
      <select
        value={selectedValue}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
      >
        <option value="">{placeholder}</option>
        {validOptions.map((option) => (
          <option key={option.id} value={option.slug}>
            {option.name} {option.count ? `(${option.count})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
