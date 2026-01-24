'use client';

import { useState, useCallback } from 'react';
import { showSuccess, showError } from '@/lib/utils/toast';

interface UseFormSubmitOptions<T> {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  onSuccess?: (data: T) => void;
  onError?: (error: string) => void;
  successMessage?: string;
  errorMessage?: string;
  showToasts?: boolean;
}

interface UseFormSubmitResult<T> {
  isLoading: boolean;
  error: string | null;
  data: T | null;
  submit: (body: Record<string, unknown>) => Promise<boolean>;
  reset: () => void;
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}

export function useFormSubmit<T = unknown>({
  url,
  method = 'POST',
  onSuccess,
  onError,
  successMessage,
  errorMessage = 'Something went wrong. Please try again.',
  showToasts = true,
}: UseFormSubmitOptions<T>): UseFormSubmitResult<T> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);

  const submit = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const result: ApiResponse<T> = await response.json();

        if (result.success) {
          setData(result.data ?? null);
          const message = successMessage || result.message;
          if (showToasts && message) {
            showSuccess(message);
          }
          onSuccess?.(result.data as T);
          return true;
        } else {
          const errorMsg = result.error || result.message || errorMessage;
          setError(errorMsg);
          if (showToasts) {
            showError(errorMsg);
          }
          onError?.(errorMsg);
          return false;
        }
      } catch {
        setError(errorMessage);
        if (showToasts) {
          showError(errorMessage);
        }
        onError?.(errorMessage);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [url, method, onSuccess, onError, successMessage, errorMessage, showToasts]
  );

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
    setData(null);
  }, []);

  return { isLoading, error, data, submit, reset };
}
