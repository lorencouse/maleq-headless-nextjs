import { z } from 'zod';

/**
 * Contact form validation schema
 */
export const contactSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  email: z.string().min(1, 'Email is required').email('Please enter a valid email'),
  subject: z.string().min(1, 'Please select a subject'),
  message: z
    .string()
    .min(10, 'Message must be at least 10 characters')
    .max(5000, 'Message is too long'),
});

export type ContactFormData = z.infer<typeof contactSchema>;

/**
 * Newsletter subscription schema
 */
export const newsletterSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email'),
});

export type NewsletterFormData = z.infer<typeof newsletterSchema>;
