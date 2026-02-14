import { z } from 'zod';

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

export type TrackOrderInput = z.infer<typeof trackOrderSchema>;
