import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ComponentProps } from 'react';
import Link from 'next/link';

/**
 * The Newsstand house button. One source of truth for CTA styling so the
 * caps/tracked/bold treatment can't drift across call sites.
 *
 * Ranks:
 *  - primary     solid red — the one action we want taken
 *  - ink         solid foreground — secondary solid (paper-on-ink in dark)
 *  - ghost       hairline border — tertiary
 *  - destructive solid destructive — delete/remove confirmations
 *
 * Complex call sites (conditional variants, template classNames) can use
 * `buttonClasses()` directly instead of the components.
 */

export type ButtonVariant = 'primary' | 'ink' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 font-bold uppercase tracking-[0.12em] rounded-lg transition-colors disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
  ink: 'bg-foreground text-background hover:opacity-80',
  ghost: 'border border-input text-foreground hover:bg-muted',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-4 py-2.5 min-h-[44px] text-xs',
  md: 'px-6 py-3 min-h-[44px] text-xs',
  lg: 'px-8 py-4 min-h-[48px] text-sm',
};

export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className = '',
): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]}${className ? ` ${className}` : ''}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses(variant, size, className)}
      {...props}
    />
  );
});

interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonLinkProps) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}

export default Button;
