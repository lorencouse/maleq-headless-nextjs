import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shopping Cart | Male Q',
  description: 'Review items in your shopping cart. Fast, discreet shipping on all orders.',
  robots: { index: false, follow: false },
};

export default function CartLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
