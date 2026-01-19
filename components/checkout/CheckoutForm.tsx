'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCartStore, useCartSubtotal } from '@/lib/store/cart-store';
import { useCheckoutStore } from '@/lib/store/checkout-store';
import ContactForm from './ContactForm';
import ShippingAddressForm from './ShippingAddressForm';
import ShippingMethod from './ShippingMethod';
import PaymentForm from './PaymentForm';
import StripeProvider from './StripeProvider';

type CheckoutStep = 'contact' | 'shipping' | 'payment';

export default function CheckoutForm() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<CheckoutStep>('contact');
  const [contactComplete, setContactComplete] = useState(false);
  const [shippingComplete, setShippingComplete] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cart and checkout state
  const items = useCartStore((state) => state.items);
  const subtotal = useCartSubtotal();
  const shipping = useCartStore((state) => state.shipping);
  const tax = useCartStore((state) => state.tax);
  const total = useCartStore((state) => state.total);
  const clearCart = useCartStore((state) => state.clearCart);

  // Checkout store for form data
  const contact = useCheckoutStore((state) => state.contact);
  const shippingAddress = useCheckoutStore((state) => state.shippingAddress);
  const shippingMethod = useCheckoutStore((state) => state.shippingMethod);
  const setContact = useCheckoutStore((state) => state.setContact);
  const setShippingAddress = useCheckoutStore((state) => state.setShippingAddress);
  const clearCheckout = useCheckoutStore((state) => state.clearCheckout);

  // Create payment intent when entering payment step
  useEffect(() => {
    if (currentStep === 'payment' && !clientSecret && total > 0) {
      createPaymentIntent();
    }
  }, [currentStep, total]);

  const createPaymentIntent = async () => {
    try {
      setError(null);
      const response = await fetch('/api/payment/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: total,
          customerEmail: contact.email,
          metadata: {
            customer_email: contact.email,
          },
          shippingAddress: {
            name: `${shippingAddress.firstName} ${shippingAddress.lastName}`,
            address: {
              line1: shippingAddress.address1,
              line2: shippingAddress.address2 || undefined,
              city: shippingAddress.city,
              state: shippingAddress.state,
              postal_code: shippingAddress.zipCode,
              country: shippingAddress.country,
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create payment intent');
      }

      const data = await response.json();
      setClientSecret(data.clientSecret);
    } catch (err) {
      console.error('Error creating payment intent:', err);
      setError('Failed to initialize payment. Please try again.');
    }
  };

  const handleContactComplete = (data: { email: string; phone: string; newsletter: boolean }) => {
    setContact(data);
    setContactComplete(true);
    setCurrentStep('shipping');
  };

  const handleShippingComplete = () => {
    setShippingComplete(true);
    setCurrentStep('payment');
  };

  const handlePaymentSuccess = async (paymentIntentId: string) => {
    try {
      setIsProcessing(true);
      setError(null);

      // Create order in WooCommerce
      const response = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentIntentId,
          contact: {
            email: contact.email,
            phone: contact.phone,
          },
          shippingAddress,
          shippingMethod: shippingMethod || {
            id: 'standard',
            name: 'Standard Shipping',
            price: shipping,
          },
          cartItems: items.map((item) => ({
            productId: item.productId,
            variationId: item.variationId,
            quantity: item.quantity,
            name: item.name,
            sku: item.sku,
          })),
          totals: {
            subtotal,
            shipping,
            tax,
            discount: 0,
            total,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create order');
      }

      const orderData = await response.json();

      // Clear cart and checkout
      clearCart();
      clearCheckout();

      // Redirect to confirmation page
      router.push(`/order-confirmation/${orderData.orderId}`);
    } catch (err) {
      console.error('Error creating order:', err);
      setError(err instanceof Error ? err.message : 'Failed to complete order');
      setIsProcessing(false);
    }
  };

  const handlePaymentError = (errorMessage: string) => {
    setError(errorMessage);
    setIsProcessing(false);
  };

  return (
    <div className="space-y-6">
      {/* Error Display */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Contact Information */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div
          className={`p-4 flex items-center justify-between cursor-pointer ${
            currentStep === 'contact' ? 'bg-muted/50' : ''
          }`}
          onClick={() => setCurrentStep('contact')}
        >
          <div className="flex items-center gap-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
              contactComplete ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>
              {contactComplete ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : '1'}
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Contact Information</h3>
              {contactComplete && currentStep !== 'contact' && (
                <p className="text-sm text-muted-foreground">{contact.email}</p>
              )}
            </div>
          </div>
          {contactComplete && currentStep !== 'contact' && (
            <button className="text-sm text-primary hover:text-primary-hover">
              Edit
            </button>
          )}
        </div>
        {currentStep === 'contact' && (
          <div className="p-4 pt-0">
            <ContactForm onComplete={handleContactComplete} />
          </div>
        )}
      </div>

      {/* Shipping */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div
          className={`p-4 flex items-center justify-between ${
            !contactComplete ? 'opacity-50' : 'cursor-pointer'
          } ${currentStep === 'shipping' ? 'bg-muted/50' : ''}`}
          onClick={() => contactComplete && setCurrentStep('shipping')}
        >
          <div className="flex items-center gap-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
              shippingComplete ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>
              {shippingComplete ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : '2'}
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Shipping</h3>
              {shippingComplete && currentStep !== 'shipping' && (
                <p className="text-sm text-muted-foreground">
                  {shippingAddress.address1}, {shippingAddress.city}, {shippingAddress.state}
                </p>
              )}
            </div>
          </div>
          {shippingComplete && currentStep !== 'shipping' && (
            <button className="text-sm text-primary hover:text-primary-hover">
              Edit
            </button>
          )}
        </div>
        {currentStep === 'shipping' && contactComplete && (
          <div className="p-4 pt-0 space-y-6">
            <ShippingAddressForm />
            <ShippingMethod onComplete={handleShippingComplete} />
          </div>
        )}
      </div>

      {/* Payment */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div
          className={`p-4 flex items-center justify-between ${
            !shippingComplete ? 'opacity-50' : ''
          } ${currentStep === 'payment' ? 'bg-muted/50' : ''}`}
        >
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium bg-muted text-muted-foreground">
              3
            </div>
            <h3 className="font-semibold text-foreground">Payment</h3>
          </div>
        </div>
        {currentStep === 'payment' && shippingComplete && (
          <div className="p-4 pt-0">
            {clientSecret ? (
              <StripeProvider clientSecret={clientSecret}>
                <PaymentForm
                  onSuccess={handlePaymentSuccess}
                  onError={handlePaymentError}
                  isProcessing={isProcessing}
                  setIsProcessing={setIsProcessing}
                />
              </StripeProvider>
            ) : (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
