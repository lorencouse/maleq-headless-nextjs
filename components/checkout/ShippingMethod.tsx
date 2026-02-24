'use client';

import { useState } from 'react';
import { useCartStore, useCartSubtotal } from '@/lib/store/cart-store';
import { useCheckoutStore } from '@/lib/store/checkout-store';
import { formatPrice, getFreeShippingProgress, FREE_SHIPPING_THRESHOLD } from '@/lib/utils/cart-helpers';
import {
  getShippingOptions,
  getShippingPrice,
  isDomesticShippingCountry,
  normalizeCountryCode,
  type ShippingOption,
} from '@/lib/checkout/shipping-rates';

interface ShippingMethodProps {
  onComplete: () => void;
}

export default function ShippingMethod({ onComplete }: ShippingMethodProps) {
  const shippingCountry = useCheckoutStore((state) => state.shippingAddress.country);
  const countryCode = normalizeCountryCode(shippingCountry);
  const shippingOptions = getShippingOptions(countryCode);

  const [selectedMethod, setSelectedMethod] = useState<string>(
    shippingOptions[0]?.id || ''
  );
  const updateShipping = useCartStore((state) => state.updateShipping);
  const setCheckoutShippingMethod = useCheckoutStore((state) => state.setShippingMethod);
  const subtotal = useCartSubtotal();

  const effectiveSelectedMethod = shippingOptions.some(
    (option) => option.id === selectedMethod
  )
    ? selectedMethod
    : (shippingOptions[0]?.id || '');

  const freeShipping = getFreeShippingProgress(subtotal, FREE_SHIPPING_THRESHOLD);
  const supportsFreeShipping = isDomesticShippingCountry(countryCode);

  const handleMethodChange = (methodId: string, option: ShippingOption) => {
    setSelectedMethod(methodId);
    updateShipping(getShippingPrice(option, subtotal));
  };

  const handleContinue = () => {
    const option = shippingOptions.find((o) => o.id === effectiveSelectedMethod);
    if (option) {
      const price = getShippingPrice(option, subtotal);
      updateShipping(price);
      setCheckoutShippingMethod({
        id: option.id,
        name: option.name,
        price,
        description: option.description,
      });
      onComplete();
    }
  };

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-foreground">Shipping Method</h4>

      <div className="space-y-3">
        {shippingOptions.map((option) => {
          const price = getShippingPrice(option, subtotal);
          const isFree = price === 0;
          const isSelected = effectiveSelectedMethod === option.id;

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
                  onChange={() => handleMethodChange(option.id, option)}
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
      {supportsFreeShipping && !freeShipping.qualifies && (
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
