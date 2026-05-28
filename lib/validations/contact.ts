import { z } from 'zod';

/**
 * See note in ./auth.ts for the factory-pattern rationale.
 */
type Translator = (key: string) => string;

/**
 * Contact form validation schema factory.
 *
 * @param t translator for the `validation.contact` namespace
 * @param tCommon translator for the `validation.common` namespace (email)
 */
export function getContactSchema(t: Translator, tCommon: Translator) {
  return z
    .object({
      name: z.string().min(1, t('nameRequired')).max(100, t('nameTooLong')),
      email: z
        .string()
        .min(1, tCommon('emailRequired'))
        .email(tCommon('emailInvalid')),
      subject: z.string().min(1, t('subjectRequired')),
      message: z
        .string()
        .min(10, t('messageTooShort'))
        .max(5000, t('messageTooLong')),
      orderNumber: z.string().max(50).optional(),
      orderLastName: z.string().max(100).optional(),
      orderEmail: z
        .string()
        .email(tCommon('emailInvalid'))
        .optional()
        .or(z.literal('')),
    })
    .refine(
      (data) => {
        if (data.subject !== 'Order Status') return true;
        return !!(
          data.orderNumber?.trim() ||
          data.orderLastName?.trim() ||
          data.orderEmail?.trim()
        );
      },
      {
        message: t('orderInfoRequired'),
        path: ['orderNumber'],
      },
    );
}

export type ContactFormData = z.infer<ReturnType<typeof getContactSchema>>;

/**
 * Newsletter subscription schema factory.
 *
 * @param tCommon translator for the `validation.common` namespace
 */
export function getNewsletterSchema(tCommon: Translator) {
  return z.object({
    email: z
      .string()
      .min(1, tCommon('emailRequired'))
      .email(tCommon('emailInvalid')),
  });
}

export type NewsletterFormData = z.infer<ReturnType<typeof getNewsletterSchema>>;
