'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UnitSystem } from '@/lib/products/size-units';

const STORAGE_KEY = 'maleq:unitSystem';
const EVENT = 'maleq:unitSystemChange';

// Default to imperial (US store); persisted choice in localStorage wins.
function read(): UnitSystem {
  if (typeof window === 'undefined') return 'imperial';
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'metric' || v === 'imperial' ? v : 'imperial';
}

/**
 * Page-wide metric/imperial preference. Persisted to localStorage and synced
 * across every hook instance (and other tabs) so all size labels flip together.
 */
export function useUnitSystem(): [UnitSystem, (s: UnitSystem) => void, () => void] {
  const [system, setSystemState] = useState<UnitSystem>('imperial');

  // hydrate from storage after mount (avoids SSR/client mismatch)
  useEffect(() => {
    setSystemState(read());
    const onChange = () => setSystemState(read());
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const setSystem = useCallback((s: UnitSystem) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, s);
      window.dispatchEvent(new Event(EVENT));
    }
    setSystemState(s);
  }, []);

  const toggle = useCallback(() => setSystem(read() === 'imperial' ? 'metric' : 'imperial'), [setSystem]);

  return [system, setSystem, toggle];
}
