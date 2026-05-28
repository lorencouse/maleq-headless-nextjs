import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Forgot Password | Male Q',
  description: 'Request a password reset link for your Male Q account.',
  robots: { index: false, follow: false },
  alternates: {
    canonical: '/forgot-password',
  },
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
