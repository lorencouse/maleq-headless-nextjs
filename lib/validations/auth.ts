import { z } from 'zod';

/**
 * Zod's validation messages are evaluated at schema-construction time, which
 * is module load — outside any React context. To get locale-aware error
 * messages we expose schema *factories* that accept a translator function
 * (e.g. the result of useTranslations('validation.auth')) and return the
 * actual schema.
 *
 * The looseTranslator type intentionally avoids next-intl's strict namespace
 * typing so this file stays independent of message-catalog typing. Pass
 * `useTranslations('validation.auth')` for auth keys and
 * `useTranslations('validation.common')` for shared keys — see usage in
 * components/auth/LoginForm.tsx and RegisterForm.tsx.
 */
type Translator = (key: string) => string;

/**
 * Login form validation schema factory.
 *
 * @param t translator for the `validation.auth` namespace
 */
export function getLoginSchema(t: Translator) {
  return z.object({
    identifier: z.string().min(1, t('identifierRequired')),
    password: z.string().min(1, t('passwordRequired')),
    rememberMe: z.boolean().optional(),
  });
}

export type LoginFormData = z.infer<ReturnType<typeof getLoginSchema>>;

/**
 * Registration form validation schema factory.
 *
 * @param t translator for the `validation.auth` namespace
 * @param tCommon translator for the `validation.common` namespace (email)
 */
export function getRegisterSchema(t: Translator, tCommon: Translator) {
  return z
    .object({
      firstName: z
        .string()
        .min(1, t('firstNameRequired'))
        .max(50, t('firstNameTooLong')),
      lastName: z
        .string()
        .min(1, t('lastNameRequired'))
        .max(50, t('lastNameTooLong')),
      email: z
        .string()
        .min(1, tCommon('emailRequired'))
        .email(tCommon('emailInvalid')),
      password: z
        .string()
        .min(12, t('passwordTooShort'))
        .max(100, t('passwordTooLong')),
      confirmPassword: z.string().min(1, t('confirmPasswordRequired')),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('passwordsMismatch'),
      path: ['confirmPassword'],
    });
}

export type RegisterFormData = z.infer<ReturnType<typeof getRegisterSchema>>;
