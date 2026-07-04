'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/store/auth-store';
import Button from '@/components/ui/Button';

interface ContactFormProps {
  onComplete: (data: { email: string; phone: string; newsletter: boolean }) => void;
}

export default function ContactForm({ onComplete }: ContactFormProps) {
  const t = useTranslations('checkout.contact');
  const tValidation = useTranslations('validation.common');
  const { user, token } = useAuthStore();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [newsletter, setNewsletter] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resolvedEmail = email || user?.email || '';

  useEffect(() => {
    if (user?.id && token && !phone) {
      fetch(`/api/customers/${user.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.billing?.phone) setPhone(data.billing.phone);
        })
        .catch(() => {});
    }
  }, [user?.id, token, phone]);

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePhone = (phone: string) => {
    // Allow empty phone or valid phone format
    if (!phone) return true;
    const phoneRegex = /^[\d\s\-\(\)\+]{10,}$/;
    return phoneRegex.test(phone);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!resolvedEmail) {
      newErrors.email = tValidation('emailRequired');
    } else if (!validateEmail(resolvedEmail)) {
      newErrors.email = tValidation('emailInvalid');
    }

    if (phone && !validatePhone(phone)) {
      newErrors.phone = t('phoneInvalid');
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      onComplete({ email: resolvedEmail, phone, newsletter });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Email */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
          {t('emailLabel')} <span className="text-destructive">*</span>
        </label>
        <input
          type="email"
          id="email"
          value={resolvedEmail}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground ${
            errors.email ? 'border-destructive' : 'border-input'
          }`}
        />
        {errors.email && (
          <p className="mt-1 text-sm text-destructive">{errors.email}</p>
        )}
      </div>

      {/* Phone (Optional) */}
      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-foreground mb-1">
          {t('phoneLabel')} <span className="text-muted-foreground">{t('optional')}</span>
        </label>
        <input
          type="tel"
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t('phonePlaceholder')}
          className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground ${
            errors.phone ? 'border-destructive' : 'border-input'
          }`}
        />
        {errors.phone && (
          <p className="mt-1 text-sm text-destructive">{errors.phone}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {t('phoneHint')}
        </p>
      </div>

      {/* Newsletter */}
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id="newsletter"
          checked={newsletter}
          onChange={(e) => setNewsletter(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
        />
        <label htmlFor="newsletter" className="text-sm text-muted-foreground">
          {t('newsletterOptIn')}
        </label>
      </div>

      {/* Continue Button */}
      <Button type="submit" size="lg" className="w-full">
        {t('continueToShipping')}
      </Button>
    </form>
  );
}
