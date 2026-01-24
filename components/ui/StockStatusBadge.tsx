'use client';

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'ON_BACKORDER' | string;

interface StockStatusBadgeProps {
  status: StockStatus;
  quantity?: number | null;
  showQuantity?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const statusConfig: Record<string, { color: string; bgColor: string; label: string }> = {
  IN_STOCK: {
    color: 'text-success',
    bgColor: 'bg-success',
    label: 'In Stock',
  },
  LOW_STOCK: {
    color: 'text-warning',
    bgColor: 'bg-warning',
    label: 'Low Stock',
  },
  OUT_OF_STOCK: {
    color: 'text-destructive',
    bgColor: 'bg-destructive',
    label: 'Out of Stock',
  },
  ON_BACKORDER: {
    color: 'text-accent',
    bgColor: 'bg-accent',
    label: 'On Backorder',
  },
};

const sizeConfig = {
  sm: {
    dot: 'w-2 h-2',
    text: 'text-xs',
    gap: 'gap-1.5',
  },
  md: {
    dot: 'w-3 h-3',
    text: 'text-sm font-medium',
    gap: 'gap-2',
  },
  lg: {
    dot: 'w-3 h-3',
    text: 'text-base font-medium',
    gap: 'gap-2',
  },
};

export default function StockStatusBadge({
  status,
  quantity,
  showQuantity = false,
  size = 'md',
  className = '',
}: StockStatusBadgeProps) {
  // Normalize status - handle different formats
  const normalizedStatus = status?.toUpperCase().replace(/-/g, '_') || 'OUT_OF_STOCK';
  const config = statusConfig[normalizedStatus] || statusConfig.OUT_OF_STOCK;
  const sizeStyles = sizeConfig[size];

  // Build label with quantity if provided
  let label = config.label;
  if (showQuantity && quantity !== null && quantity !== undefined && quantity > 0) {
    if (normalizedStatus === 'LOW_STOCK') {
      label = `Low Stock (${quantity} left)`;
    } else if (normalizedStatus === 'IN_STOCK') {
      label = `In Stock`;
    }
  }

  return (
    <div className={`inline-flex items-center ${sizeStyles.gap} ${className}`}>
      <div className={`${sizeStyles.dot} ${config.bgColor} rounded-full`} />
      <span className={`${sizeStyles.text} ${config.color}`}>{label}</span>
      {showQuantity && quantity !== null && quantity !== undefined && quantity > 0 && normalizedStatus === 'IN_STOCK' && (
        <span className="text-sm text-muted-foreground">
          ({quantity} available)
        </span>
      )}
    </div>
  );
}
