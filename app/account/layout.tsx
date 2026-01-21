import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Account | Maleq',
  description: 'Manage your Maleq account. View orders, update addresses, and manage your profile.',
};

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
