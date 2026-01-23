import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reset Password | Male Q',
  description: 'Reset your Male Q account password. Enter your email to receive password reset instructions.',
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
