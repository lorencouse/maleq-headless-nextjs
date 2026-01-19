'use client';

import { useState } from 'react';
import { useCartStore, useCartSubtotal } from '@/lib/store/cart-store';
import { formatPrice, getFreeShippingProgress } from '@/lib/utils/cart-helpers';

interface ShippingMethodProps {
  onComplete: () => void;
}

const FREE_SHIPPING_THRESHOLD = 100;

// Shipping options - these would typically come from WooCommerce
const SHIPPING_OPTIONS = [
  {
    id: 'standard',
    name: 'Standard Shipping',
    description: '5-7 business days',
    price: 7.99,
    freeThreshold: FREE_SHIPPING_THRESHOLD,
  },
  {
    id: 'express',
    name: 'Express Shipping',
    description: '2-3 business days',
    price: 14.99,
    freeThreshold: null, // Never free
  },
  {
    id: 'overnight',
    name: 'Overnight Shipping',
    description: 'Next business day',
    price: 24.99,
    freeThreshold: null,
  },
];

export default function ShippingMethod({ onComplete }: ShippingMethodProps) {
  const [selectedMethod, setSelectedMethod] = useState<string>('standard');
  const updateShipping = useCartStore((state) => state.updateShipping);
  const subtotal = useCartSubtotal();

  const freeShipping = getFreeShippingProgress(subtotal, FREE_SHIPPING_THRESHOLD);

  const getShippingPrice = (option: typeof SHIPPING_OPTIONS[0]) => {
    if (option.freeThreshold && subtotal >= option.freeThreshold) {
      return 0;
    }
    return option.price;
  };

  const handleMethodChange = (methodId: string) => {
    setSelectedMethod(methodId);
    const option = SHIPPING_OPTIONS.find(o => o.id === methodId);
    if (option) {
      updateShipping(getShippingPrice(option));
    }
  };

  const handleContinue = () => {
    const option = SHIPPING_OPTIONS.find(o => o.id === selectedMethod);
    if (option) {
      updateShipping(getShippingPrice(option));
      onComplete();
    }
  };

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-foreground">Shipping Method</h4>

      <div className="space-y-3">
        {SHIPPING_OPTIONS.map((option) => {
          const price = getShippingPrice(option);
          const isFree = price === 0;
          const isSelected = selectedMethod === option.id;

          return (
            <label
              key={option.id}
              className={`flex items-center justify-between p-4 border rounded-lg cursor-pointer transition-colors ${
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-input hover:border-primary/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="shippingMethod"
                  value={option.id}
                  checked={isSelected}
                  onChange={() => handleMethodChange(option.id)}
                  className="h-4 w-4 text-primary focus:ring-primary border-input"
                />
                <div>
                  <p className="font-medium text-foreground">{option.name}</p>
                  <p className="text-sm text-muted-foreground">{option.description}</p>
                </div>
              </div>
              <div className="text-right">
                {isFree ? (
                  <div>
                    <p className="font-medium text-primary">FREE</p>
                    <p className="text-xs text-muted-foreground line-through">
                      {formatPrice(option.price)}
                    </p>
                  </div>
                ) : (
                  <p className="font-medium text-foreground">{formatPrice(option.price)}</p>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {/* Free Shipping Notice */}
      {!freeShipping.qualifies && (
        <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
          <p>
            Add {formatPrice(freeShipping.remaining)} more to qualify for free standard shipping!
          </p>
        </div>
      )}

      {/* Continue Button */}
      <button
        onClick={handleContinue}
        className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold"
      >
        Continue to Payment
      </button>
    </div>
  );
}
