import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Checkout | Maleq',
  description: 'Complete your order securely. Discreet billing and fast shipping available.',
};

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
