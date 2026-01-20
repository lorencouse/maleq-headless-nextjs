import {
  getStateTaxRate,
  calculateTax,
  stateHasSalesTax,
  formatTaxRate,
  NO_TAX_STATES,
} from '@/lib/utils/tax-calculator';

describe('Tax Calculator', () => {
  describe('getStateTaxRate', () => {
    it('should return correct rate for known states', () => {
      expect(getStateTaxRate('CA')).toBe(0.0725);
      expect(getStateTaxRate('TX')).toBe(0.0625);
      expect(getStateTaxRate('NY')).toBe(0.04);
    });

    it('should return 0 for unknown states', () => {
      expect(getStateTaxRate('XX')).toBe(0);
    });

    it('should be case insensitive', () => {
      expect(getStateTaxRate('ca')).toBe(0.0725);
      expect(getStateTaxRate('Ca')).toBe(0.0725);
    });

    it('should return 0 for tax-free states', () => {
      NO_TAX_STATES.forEach(state => {
        expect(getStateTaxRate(state)).toBe(0);
      });
    });
  });

  describe('stateHasSalesTax', () => {
    it('should return true for taxable states', () => {
      expect(stateHasSalesTax('CA')).toBe(true);
      expect(stateHasSalesTax('TX')).toBe(true);
    });

    it('should return false for tax-free states', () => {
      expect(stateHasSalesTax('MT')).toBe(false);
      expect(stateHasSalesTax('NH')).toBe(false);
      expect(stateHasSalesTax('OR')).toBe(false);
    });
  });

  describe('calculateTax', () => {
    it('should calculate tax correctly', () => {
      const result = calculateTax(100, 10, 'CA');
      expect(result.taxRate).toBe(0.0725);
      expect(result.taxAmount).toBe(7.25);
      expect(result.taxableAmount).toBe(100);
    });

    it('should include shipping in tax when specified', () => {
      const result = calculateTax(100, 10, 'CA', true);
      expect(result.taxableAmount).toBe(110);
      expect(result.taxAmount).toBeCloseTo(7.98, 1);
    });

    it('should return 0 tax for tax-free states', () => {
      const result = calculateTax(100, 10, 'OR');
      expect(result.taxAmount).toBe(0);
    });
  });

  describe('formatTaxRate', () => {
    it('should format tax rate as percentage', () => {
      expect(formatTaxRate(0.0725)).toBe('7.25%');
      expect(formatTaxRate(0.0625)).toBe('6.25%');
    });

    it('should handle zero rate', () => {
      expect(formatTaxRate(0)).toBe('0.00%');
    });
  });
});
