'use client';

interface QuantitySelectorProps {
  quantity: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  size?: 'sm' | 'md';
  onQuantityChange: (newQuantity: number) => void;
  showInput?: boolean;
}

export default function QuantitySelector({
  quantity,
  min = 1,
  max = 99,
  disabled = false,
  size = 'md',
  onQuantityChange,
  showInput = false,
}: QuantitySelectorProps) {
  const handleIncrement = () => {
    if (quantity < max) {
      onQuantityChange(quantity + 1);
    }
  };

  const handleDecrement = () => {
    if (quantity > min) {
      onQuantityChange(quantity - 1);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuantity = parseInt(e.target.value) || min;
    if (newQuantity >= min && newQuantity <= max) {
      onQuantityChange(newQuantity);
    }
  };

  const isSmall = size === 'sm';

  return (
    <div className={`flex items-center border border-border ${isSmall ? 'rounded' : 'rounded-lg'}`}>
      <button
        onClick={handleDecrement}
        disabled={quantity <= min || disabled}
        className={`
          ${isSmall ? 'px-2 py-1 text-sm' : 'px-3 py-2'}
          text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors
        `}
        aria-label="Decrease quantity"
      >
        {isSmall ? (
          '-'
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        )}
      </button>

      {showInput ? (
        <input
          type="number"
          min={min}
          max={max}
          value={quantity}
          onChange={handleInputChange}
          disabled={disabled}
          className={`
            ${isSmall ? 'w-10 text-sm' : 'w-16'}
            text-center py-2 bg-transparent focus:outline-none
            [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
          `}
          aria-label="Quantity"
        />
      ) : (
        <span className={`
          ${isSmall ? 'px-3 py-1 text-sm min-w-[32px]' : 'px-4 py-2 min-w-[48px]'}
          font-medium text-center
        `}>
          {quantity}
        </span>
      )}

      <button
        onClick={handleIncrement}
        disabled={quantity >= max || disabled}
        className={`
          ${isSmall ? 'px-2 py-1 text-sm' : 'px-3 py-2'}
          text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors
        `}
        aria-label="Increase quantity"
      >
        {isSmall ? (
          '+'
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        )}
      </button>
    </div>
  );
}
