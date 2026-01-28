/**
 * Toast Notification Helpers
 *
 * Wrapper functions for react-hot-toast with consistent styling
 */

import toast from 'react-hot-toast';
import { useUIStore } from '@/lib/store/ui-store';

/**
 * Show success toast
 */
export function showSuccess(message: string, duration?: number) {
  return toast.success(message, { duration });
}

/**
 * Show "added to cart" toast that opens mini-cart when clicked
 */
export function showAddedToCart(productName: string, duration: number = 4000) {
  return toast.custom(
    (t) => (
      <div
        className={`${
          t.visible ? 'animate-enter' : 'animate-leave'
        } max-w-sm w-full bg-white dark:bg-gray-800 shadow-lg rounded-lg pointer-events-auto ring-1 ring-black ring-opacity-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors`}
        onClick={() => {
          useUIStore.getState().openMiniCart();
          toast.dismiss(t.id);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            useUIStore.getState().openMiniCart();
            toast.dismiss(t.id);
          }
        }}
      >
        <div className="flex items-center p-4 gap-3">
          <div className="flex-shrink-0">
            <svg
              className="h-6 w-6 text-green-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {productName} added to cart!
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Click to view cart
            </p>
          </div>
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.25 4.5l7.5 7.5-7.5 7.5"
              />
            </svg>
          </div>
        </div>
      </div>
    ),
    { duration }
  );
}

/**
 * Show error toast
 */
export function showError(message: string, duration?: number) {
  return toast.error(message, { duration });
}

/**
 * Show loading toast
 */
export function showLoading(message: string) {
  return toast.loading(message);
}

/**
 * Show info toast
 */
export function showInfo(message: string, duration?: number) {
  return toast(message, {
    duration,
    icon: 'ℹ️',
  });
}

/**
 * Show custom toast with action button
 */
export function showToastWithAction(
  message: string,
  actionLabel: string,
  onAction: () => void,
  duration?: number
) {
  return toast.custom(
    (t) => (
      <div
        className={`${
          t.visible ? 'animate-enter' : 'animate-leave'
        } max-w-md w-full bg-white dark:bg-gray-800 shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5`}
      >
        <div className="flex-1 w-0 p-4">
          <div className="flex items-start">
            <div className="ml-3 flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {message}
              </p>
            </div>
          </div>
        </div>
        <div className="flex border-l border-gray-200 dark:border-gray-700">
          <button
            onClick={() => {
              onAction();
              toast.dismiss(t.id);
            }}
            className="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {actionLabel}
          </button>
        </div>
        <div className="flex border-l border-gray-200 dark:border-gray-700">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Close
          </button>
        </div>
      </div>
    ),
    { duration }
  );
}

/**
 * Dismiss a specific toast
 */
export function dismissToast(toastId: string) {
  toast.dismiss(toastId);
}

/**
 * Dismiss all toasts
 */
export function dismissAllToasts() {
  toast.dismiss();
}

/**
 * Promise-based toast (shows loading, then success/error)
 */
export function showPromiseToast<T>(
  promise: Promise<T>,
  messages: {
    loading: string;
    success: string;
    error: string;
  }
): Promise<T> {
  return toast.promise(promise, messages);
}
