import { Suspense } from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import LoginForm from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to your Male Q account to view orders, manage addresses, and more.',
};

export default function LoginPage() {
  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <span className="text-3xl font-bold text-primary">Male Q</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-foreground">Welcome back</h1>
          <p className="mt-2 text-muted-foreground">
            Sign in to your account to continue
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
          <Suspense fallback={<div className="h-64 flex items-center justify-center text-muted-foreground">Loading...</div>}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          By signing in, you agree to our{' '}
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
