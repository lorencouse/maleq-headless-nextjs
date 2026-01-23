import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Account | Male Q',
  description: 'Manage your Male Q account. View orders, update addresses, and manage your profile.',
};

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
