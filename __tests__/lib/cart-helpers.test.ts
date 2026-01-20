import {
  calculateCartSubtotal,
  calculateCartTotal,
  calculateLineSubtotal,
  formatPrice,
  generateCartItemId,
  validateQuantity,
  calculateSavings,
  calculateSavingsPercentage,
  getFreeShippingProgress,
  estimateTax,
} from '@/lib/utils/cart-helpers';
import { CartItem } from '@/lib/types/cart';

describe('Cart Helpers', () => {
  describe('generateCartItemId', () => {
    it('should generate ID from product ID only', () => {
      expect(generateCartItemId('123')).toBe('123');
    });

    it('should generate ID from product and variation IDs', () => {
      expect(generateCartItemId('123', '456')).toBe('123-456');
    });
  });

  describe('calculateLineSubtotal', () => {
    it('should calculate line subtotal correctly', () => {
      expect(calculateLineSubtotal(10, 2)).toBe(20);
      expect(calculateLineSubtotal(15.5, 3)).toBe(46.5);
    });

    it('should round to 2 decimal places', () => {
      expect(calculateLineSubtotal(10.999, 1)).toBe(11);
    });
  });

  describe('calculateCartSubtotal', () => {
    it('should return 0 for empty cart', () => {
      expect(calculateCartSubtotal([])).toBe(0);
    });

    it('should calculate subtotal from items', () => {
      const items = [
        { subtotal: 20 },
        { subtotal: 15.5 },
      ] as CartItem[];
      expect(calculateCartSubtotal(items)).toBe(35.5);
    });
  });

  describe('calculateCartTotal', () => {
    it('should calculate total with all values', () => {
      expect(calculateCartTotal(100, 8.25, 10, 5)).toBe(113.25);
    });

    it('should handle zero values', () => {
      expect(calculateCartTotal(50)).toBe(50);
    });

    it('should not go below zero', () => {
      expect(calculateCartTotal(10, 0, 0, 20)).toBe(0);
    });
  });

  describe('formatPrice', () => {
    it('should format price with currency symbol', () => {
      expect(formatPrice(99.99)).toBe('$99.99');
    });

    it('should handle zero', () => {
      expect(formatPrice(0)).toBe('$0.00');
    });
  });

  describe('validateQuantity', () => {
    it('should return valid for correct quantity', () => {
      const result = validateQuantity(5, 10, true);
      expect(result.isValid).toBe(true);
      expect(result.validQuantity).toBe(5);
    });

    it('should return invalid for quantity less than 1', () => {
      const result = validateQuantity(0, 10, true);
      expect(result.isValid).toBe(false);
      expect(result.validQuantity).toBe(1);
    });

    it('should return invalid for out of stock', () => {
      const result = validateQuantity(1, 10, false);
      expect(result.isValid).toBe(false);
      expect(result.validQuantity).toBe(0);
    });

    it('should return invalid for exceeding max quantity', () => {
      const result = validateQuantity(15, 10, true);
      expect(result.isValid).toBe(false);
      expect(result.validQuantity).toBe(10);
    });
  });

  describe('calculateSavings', () => {
    it('should calculate savings amount', () => {
      expect(calculateSavings(100, 75)).toBe(25);
    });

    it('should return 0 if sale price is higher', () => {
      expect(calculateSavings(50, 75)).toBe(0);
    });
  });

  describe('calculateSavingsPercentage', () => {
    it('should calculate savings percentage', () => {
      expect(calculateSavingsPercentage(100, 75)).toBe(25);
    });

    it('should return 0 for invalid regular price', () => {
      expect(calculateSavingsPercentage(0, 50)).toBe(0);
    });
  });

  describe('getFreeShippingProgress', () => {
    it('should show progress toward free shipping', () => {
      const result = getFreeShippingProgress(50, 100);
      expect(result.qualifies).toBe(false);
      expect(result.remaining).toBe(50);
      expect(result.percentage).toBe(50);
    });

    it('should show qualified for free shipping', () => {
      const result = getFreeShippingProgress(150, 100);
      expect(result.qualifies).toBe(true);
      expect(result.remaining).toBe(0);
      expect(result.percentage).toBe(100);
    });
  });

  describe('estimateTax', () => {
    it('should calculate tax at default rate', () => {
      expect(estimateTax(100)).toBe(8);
    });

    it('should calculate tax at custom rate', () => {
      expect(estimateTax(100, 0.1)).toBe(10);
    });
  });
});
