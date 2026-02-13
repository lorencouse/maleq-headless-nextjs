import { Suspense } from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import RegisterForm from '@/components/auth/RegisterForm';

export const metadata: Metadata = {
  title: 'Create Account',
  description: 'Create a Male Q account to track orders, save addresses, and enjoy a faster checkout.',
};

export default function RegisterPage() {
  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <span className="text-3xl font-bold text-primary">Male Q</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-foreground">Create your account</h1>
          <p className="mt-2 text-muted-foreground">
            Join Male Q for a better shopping experience
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
          <Suspense fallback={<div className="h-64 flex items-center justify-center text-muted-foreground">Loading...</div>}>
            <RegisterForm />
          </Suspense>
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          By creating an account, you agree to our{' '}
          <Link href="/terms" className="text-primary hover:text-primary-hover">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="text-primary hover:text-primary-hover">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
