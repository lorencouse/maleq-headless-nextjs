'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
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
import Button from '@/components/ui/Button';

interface ShippingMethodProps {
  onComplete: () => void;
}

export default function ShippingMethod({ onComplete }: ShippingMethodProps) {
  const t = useTranslations('checkout.shippingMethod');

  // Localized tier name/description for DISPLAY only, keyed by the option id
  // (tiers.<id> in the catalog) with fallback to the English rate literal. The
  // values stored on the order + sent to analytics stay English (see below).
  const tierName = (option: ShippingOption) => {
    const key = `tiers.${option.id}.name`;
    return t.has(key) ? t(key) : option.name;
  };
  const tierDescription = (option: ShippingOption) => {
    const key = `tiers.${option.id}.description`;
    return t.has(key) ? t(key) : option.description;
  };
  const shippingAddress = useCheckoutStore((state) => state.shippingAddress);
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
  const missingRequiredFields = useMemo(() => {
    const requiredFields: Array<{
      key: keyof typeof shippingAddress;
      label: string;
    }> = [
      { key: 'firstName', label: 'First name' },
      { key: 'lastName', label: 'Last name' },
      { key: 'address1', label: 'Address' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State/Region' },
      { key: 'zipCode', label: 'ZIP/Postal code' },
      { key: 'country', label: 'Country' },
    ];

    return requiredFields
      .filter((field) => !shippingAddress[field.key]?.trim())
      .map((field) => field.label);
  }, [shippingAddress]);
  const isAddressComplete = missingRequiredFields.length === 0;

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
      <h4 className="font-medium text-foreground">{t('heading')}</h4>

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
                  <p className="font-medium text-foreground">{tierName(option)}</p>
                  <p className="text-sm text-muted-foreground">{tierDescription(option)}</p>
                </div>
              </div>
              <div className="text-right">
                {isFree ? (
                  <div>
                    <p className="font-medium text-primary">{t('free')}</p>
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
            {t('freeShippingNotice', { amount: formatPrice(freeShipping.remaining) })}
          </p>
        </div>
      )}

      {!isAddressComplete && (
        <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg text-sm text-foreground">
          {t('completeAddressNotice')}
        </div>
      )}

      {/* Continue Button */}
      <Button
        onClick={handleContinue}
        disabled={!isAddressComplete}
        size="lg"
        className="w-full"
      >
        {t('continueToPayment')}
      </Button>
    </div>
  );
}
