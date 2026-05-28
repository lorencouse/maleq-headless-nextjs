import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
  alternates: {
    canonical: '/checkout',
  },
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
