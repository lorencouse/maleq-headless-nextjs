'use client';

interface QuantitySelectorProps {
  quantity: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  size?: 'sm' | 'md';
  onQuantityChange: (newQuantity: number) => void;
  onRemove?: () => void; // Called when minus is clicked at min quantity
  showInput?: boolean;
}

export default function QuantitySelector({
  quantity,
  min = 1,
  max = 99,
  disabled = false,
  size = 'md',
  onQuantityChange,
  onRemove,
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
    } else if (quantity === min && onRemove) {
      onRemove();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuantity = parseInt(e.target.value) || min;
    if (newQuantity >= min && newQuantity <= max) {
      onQuantityChange(newQuantity);
    }
  };

  const isSmall = size === 'sm';

  // Ensure minimum 44px touch targets for accessibility
  const buttonClass = isSmall
    ? 'min-w-[36px] min-h-[36px] px-2 py-1.5 text-sm flex items-center justify-center'
    : 'min-w-[44px] min-h-[44px] px-3 py-2 flex items-center justify-center';

  return (
    <div className={`inline-flex items-center border border-border ${isSmall ? 'rounded' : 'rounded-lg'}`}>
      <button
        onClick={handleDecrement}
        disabled={(quantity <= min && !onRemove) || disabled}
        className={`
          ${buttonClass}
          text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors
          ${quantity === min && onRemove ? 'hover:text-destructive' : ''}
        `}
        aria-label={quantity === min && onRemove ? "Remove item" : "Decrease quantity"}
      >
        {isSmall ? (
          <span className="text-base font-medium">−</span>
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
            ${isSmall ? 'w-10 text-sm' : 'w-14'}
            text-center py-2 bg-transparent focus:outline-none font-medium
            [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
          `}
          aria-label="Quantity"
        />
      ) : (
        <span className={`
          ${isSmall ? 'px-2 py-1 text-sm min-w-[28px]' : 'px-3 py-2 min-w-[40px]'}
          font-medium text-center
        `}>
          {quantity}
        </span>
      )}

      <button
        onClick={handleIncrement}
        disabled={quantity >= max || disabled}
        className={`
          ${buttonClass}
          text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors
        `}
        aria-label="Increase quantity"
      >
        {isSmall ? (
          <span className="text-base font-medium">+</span>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        )}
      </button>
    </div>
  );
}
