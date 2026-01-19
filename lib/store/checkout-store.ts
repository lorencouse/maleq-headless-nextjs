import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { calculateTax, TaxCalculationResult } from '@/lib/utils/tax-calculator';

/**
 * Checkout State Management
 *
 * Stores all checkout form data across sections.
 * Persists to sessionStorage (cleared when browser closes).
 */

export interface ContactInfo {
  email: string;
  phone: string;
  newsletter: boolean;
}

export interface ShippingAddress {
  firstName: string;
  lastName: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface BillingAddress extends ShippingAddress {
  sameAsShipping: boolean;
}

export interface ShippingMethodInfo {
  id: string;
  name: string;
  price: number;
  description: string;
}

export interface CheckoutTotals {
  subtotal: number;
  shipping: number;
  tax: number;
  discount: number;
  total: number;
}

interface CheckoutState {
  // Form data
  contact: ContactInfo;
  shippingAddress: ShippingAddress;
  billingAddress: BillingAddress;
  shippingMethod: ShippingMethodInfo | null;

  // Calculated values
  taxInfo: TaxCalculationResult | null;
  totals: CheckoutTotals;

  // Form validation state
  contactComplete: boolean;
  shippingComplete: boolean;
  paymentComplete: boolean;

  // Current step
  currentStep: 'contact' | 'shipping' | 'payment';

  // Loading/error states
  isProcessing: boolean;
  error: string | null;
}

interface CheckoutActions {
  // Setters
  setContact: (contact: Partial<ContactInfo>) => void;
  setShippingAddress: (address: Partial<ShippingAddress>) => void;
  setBillingAddress: (address: Partial<BillingAddress>) => void;
  setShippingMethod: (method: ShippingMethodInfo) => void;

  // Step management
  setCurrentStep: (step: CheckoutState['currentStep']) => void;
  completeContact: () => void;
  completeShipping: () => void;
  completePayment: () => void;

  // Tax calculation
  calculateTax: (subtotal: number, shipping: number) => void;

  // Totals
  updateTotals: (totals: Partial<CheckoutTotals>) => void;

  // Processing
  setProcessing: (isProcessing: boolean) => void;
  setError: (error: string | null) => void;

  // Reset
  clearCheckout: () => void;
}

const initialContact: ContactInfo = {
  email: '',
  phone: '',
  newsletter: false,
};

const initialShippingAddress: ShippingAddress = {
  firstName: '',
  lastName: '',
  company: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  zipCode: '',
  country: 'US',
};

const initialBillingAddress: BillingAddress = {
  ...initialShippingAddress,
  sameAsShipping: true,
};

const initialTotals: CheckoutTotals = {
  subtotal: 0,
  shipping: 0,
  tax: 0,
  discount: 0,
  total: 0,
};

const initialState: CheckoutState = {
  contact: initialContact,
  shippingAddress: initialShippingAddress,
  billingAddress: initialBillingAddress,
  shippingMethod: null,
  taxInfo: null,
  totals: initialTotals,
  contactComplete: false,
  shippingComplete: false,
  paymentComplete: false,
  currentStep: 'contact',
  isProcessing: false,
  error: null,
};

export const useCheckoutStore = create<CheckoutState & CheckoutActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      setContact: (contact) =>
        set((state) => ({
          contact: { ...state.contact, ...contact },
        })),

      setShippingAddress: (address) =>
        set((state) => ({
          shippingAddress: { ...state.shippingAddress, ...address },
        })),

      setBillingAddress: (address) =>
        set((state) => ({
          billingAddress: { ...state.billingAddress, ...address },
        })),

      setShippingMethod: (method) =>
        set((state) => {
          const newTotals = {
            ...state.totals,
            shipping: method.price,
            total: state.totals.subtotal + method.price + state.totals.tax - state.totals.discount,
          };
          return {
            shippingMethod: method,
            totals: newTotals,
          };
        }),

      setCurrentStep: (step) => set({ currentStep: step }),

      completeContact: () =>
        set({
          contactComplete: true,
          currentStep: 'shipping',
        }),

      completeShipping: () =>
        set({
          shippingComplete: true,
          currentStep: 'payment',
        }),

      completePayment: () =>
        set({
          paymentComplete: true,
        }),

      calculateTax: (subtotal, shipping) => {
        const state = get();
        const stateCode = state.shippingAddress.state;

        if (!stateCode) {
          set({ taxInfo: null });
          return;
        }

        const taxResult = calculateTax(subtotal, shipping, stateCode);
        const newTotal = subtotal + shipping + taxResult.taxAmount - state.totals.discount;

        set({
          taxInfo: taxResult,
          totals: {
            ...state.totals,
            subtotal,
            shipping,
            tax: taxResult.taxAmount,
            total: newTotal,
          },
        });
      },

      updateTotals: (totals) =>
        set((state) => {
          const newTotals = { ...state.totals, ...totals };
          newTotals.total = newTotals.subtotal + newTotals.shipping + newTotals.tax - newTotals.discount;
          return { totals: newTotals };
        }),

      setProcessing: (isProcessing) => set({ isProcessing }),

      setError: (error) => set({ error }),

      clearCheckout: () => set(initialState),
    }),
    {
      name: 'checkout-storage',
      storage: {
        getItem: (name) => {
          const str = sessionStorage.getItem(name);
          return str ? JSON.parse(str) : null;
        },
        setItem: (name, value) => {
          sessionStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          sessionStorage.removeItem(name);
        },
      },
    }
  )
);

// Selectors
export const useCheckoutContact = () => useCheckoutStore((state) => state.contact);
export const useCheckoutShipping = () => useCheckoutStore((state) => state.shippingAddress);
export const useCheckoutBilling = () => useCheckoutStore((state) => state.billingAddress);
export const useCheckoutMethod = () => useCheckoutStore((state) => state.shippingMethod);
export const useCheckoutTotals = () => useCheckoutStore((state) => state.totals);
export const useCheckoutTax = () => useCheckoutStore((state) => state.taxInfo);
export const useCheckoutStep = () => useCheckoutStore((state) => state.currentStep);
export const useIsCheckoutProcessing = () => useCheckoutStore((state) => state.isProcessing);
