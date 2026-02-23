import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shopping Cart',
  robots: { index: false, follow: false },
  alternates: {
    canonical: '/cart',
  },
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function CartLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
