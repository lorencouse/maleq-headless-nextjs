'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCartStore } from '@/lib/store/cart-store';
import { setCartRecoveryKey } from '@/lib/cart-recovery/client';

type RecoveryState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

function buildNextCartUrl(searchParams: URLSearchParams, recovered: string): string {
  const next = new URLSearchParams(searchParams.toString());
  next.delete('recovery');
  next.set('recovered', recovered);
  const query = next.toString();
  return query ? `/cart?${query}` : '/cart';
}

export default function CartRecoveryHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const replaceCart = useCartStore((state) => state.replaceCart);
  const recoveryToken = searchParams.get('recovery');
  const recoveredState = searchParams.get('recovered');
  const [state, setState] = useState<RecoveryState>({ kind: 'idle' });

  const passiveMessage = useMemo(() => {
    if (recoveredState === '1') {
      return 'Your saved cart has been restored. You can continue where you left off.';
    }
    if (recoveredState === '0') {
      return 'We could not restore that saved cart. The link may be invalid or expired.';
    }
    return null;
  }, [recoveredState]);

  useEffect(() => {
    if (!recoveryToken) {
      return;
    }

    let cancelled = false;
    setState({ kind: 'loading' });

    const run = async () => {
      try {
        const response = await fetch(
          `/api/cart-recovery/restore?token=${encodeURIComponent(recoveryToken)}`
        );
        const data = await response.json();

        if (!response.ok || !data?.success || !data?.data?.cart) {
          throw new Error(data?.error || 'Failed to restore cart');
        }

        setCartRecoveryKey(data.data.cartKey);
        replaceCart(data.data.cart);

        if (cancelled) return;
        setState({
          kind: 'success',
          message: 'Your saved cart has been restored. You can continue where you left off.',
        });
        router.replace(
          buildNextCartUrl(new URLSearchParams(searchParams.toString()), '1'),
          { scroll: false }
        );
      } catch (error) {
        if (cancelled) return;
        setState({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'We could not restore that saved cart.',
        });
        router.replace(
          buildNextCartUrl(new URLSearchParams(searchParams.toString()), '0'),
          { scroll: false }
        );
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [recoveryToken, replaceCart, router, searchParams]);

  const message =
    state.kind === 'loading'
      ? 'Restoring your saved cart...'
      : state.kind === 'success'
        ? state.message
        : state.kind === 'error'
          ? state.message
          : passiveMessage;

  if (!message) {
    return null;
  }

  const isError = state.kind === 'error' || recoveredState === '0';
  const isLoading = state.kind === 'loading';

  return (
    <div
      className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
        isError
          ? 'border-destructive/20 bg-destructive/10 text-destructive'
          : isLoading
            ? 'border-info/20 bg-info/10 text-info'
            : 'border-success/20 bg-success/10 text-success'
      }`}
    >
      {message}
    </div>
  );
}
