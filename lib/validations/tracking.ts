import { z } from 'zod';

/**
 * See note in ./auth.ts for the factory-pattern rationale.
 *
 * This file exports BOTH a factory (for client-side, locale-aware error
 * messages) AND a fixed English schema (for the /api/track-order route
 * handler which runs outside React). The two schemas validate the exact
 * same shape; only the error message strings differ.
 */
type Translator = (key: string) => string;

/**
 * Client-side track-order schema factory.
 *
 * @param t translator for the `validation.trackOrder` namespace
 * @param tCommon translator for the `validation.common` namespace (email)
 */
export function getTrackOrderSchema(t: Translator, tCommon: Translator) {
  return z.object({
    orderNumber: z
      .string()
      .min(1, t('orderNumberRequired'))
      .transform((val) => val.trim()),
    email: z
      .string()
      .min(1, tCommon('emailRequired'))
      .email(tCommon('emailInvalid'))
      .transform((val) => val.trim().toLowerCase()),
  });
}

export type TrackOrderInput = z.infer<ReturnType<typeof getTrackOrderSchema>>;

/**
 * Server-side track-order schema with hardcoded English messages.
 *
 * Used by app/api/track-order/route.ts where no React context (and so no
 * useTranslations) is available. API error bodies are surfaced to the client
 * via `data.error`; if locale-aware API errors are needed later, switch the
 * route handler to error codes and resolve to messages in the client.
 */
export const trackOrderSchema = z.object({
  orderNumber: z
    .string()
    .min(1, 'Order number is required')
    .transform((val) => val.trim()),
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address')
    .transform((val) => val.trim().toLowerCase()),
});
