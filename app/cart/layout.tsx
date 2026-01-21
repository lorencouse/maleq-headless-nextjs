import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shopping Cart | Maleq',
  description: 'Review items in your shopping cart. Fast, discreet shipping on all orders.',
};

export default function CartLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
