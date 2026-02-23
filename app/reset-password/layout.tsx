import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reset Password | Male Q',
  description: 'Reset your Male Q account password securely.',
  robots: { index: false, follow: false },
  alternates: {
    canonical: '/reset-password',
  },
};

export default function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
