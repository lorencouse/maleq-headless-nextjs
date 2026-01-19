'use client';

interface StockFilterProps {
  inStock: boolean;
  onSale: boolean;
  onInStockChange: (value: boolean) => void;
  onSaleChange: (value: boolean) => void;
}

export default function StockFilter({
  inStock,
  onSale,
  onInStockChange,
  onSaleChange,
}: StockFilterProps) {
  return (
    <div className="pt-3 space-y-3">
      {/* In Stock */}
      <label className="flex items-center gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={inStock}
          onChange={(e) => onInStockChange(e.target.checked)}
          className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
        />
        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
          In Stock Only
        </span>
      </label>

      {/* On Sale */}
      <label className="flex items-center gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={onSale}
          onChange={(e) => onSaleChange(e.target.checked)}
          className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
        />
        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
          On Sale
        </span>
      </label>
    </div>
  );
}
