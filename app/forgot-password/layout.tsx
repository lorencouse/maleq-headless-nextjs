import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reset Password | Maleq',
  description: 'Reset your Maleq account password. Enter your email to receive password reset instructions.',
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
