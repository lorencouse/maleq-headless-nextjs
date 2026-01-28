/**
 * UI Store
 *
 * Global state management for UI elements using Zustand
 * Manages modals, sidebars, and other UI states that need to be
 * controlled from anywhere in the app
 */

'use client';

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

interface UIState {
  // Mini Cart
  isMiniCartOpen: boolean;
  openMiniCart: () => void;
  closeMiniCart: () => void;
  toggleMiniCart: () => void;
}

export const useUIStore = create<UIState>()((set) => ({
  // Mini Cart
  isMiniCartOpen: false,
  openMiniCart: () => set({ isMiniCartOpen: true }),
  closeMiniCart: () => set({ isMiniCartOpen: false }),
  toggleMiniCart: () => set((state) => ({ isMiniCartOpen: !state.isMiniCartOpen })),
}));

/**
 * Hook to get mini cart open state
 */
export function useMiniCartOpen(): boolean {
  return useUIStore((state) => state.isMiniCartOpen);
}

/**
 * Hook to get mini cart controls - uses useShallow to prevent infinite loops
 */
export function useMiniCartControls() {
  return useUIStore(
    useShallow((state) => ({
      open: state.openMiniCart,
      close: state.closeMiniCart,
      toggle: state.toggleMiniCart,
    }))
  );
}
