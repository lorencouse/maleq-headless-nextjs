'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { showSuccess, showError, showInfo } from '@/lib/utils/toast';
import { getContactSchema, type ContactFormData } from '@/lib/validations/contact';
import { submitWithSync } from '@/lib/pwa/background-sync';

export default function ContactForm() {
  const tValidation = useTranslations('validation.contact');
  const tValidationCommon = useTranslations('validation.common');
  const t = useTranslations('contactPage');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [formLoadedAt] = useState(() => Date.now());

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<ContactFormData>({
    resolver: zodResolver(getContactSchema(tValidation, tValidationCommon)),
    defaultValues: {
      name: '',
      email: '',
      subject: '',
      message: '',
      orderNumber: '',
      orderLastName: '',
      orderEmail: '',
    },
  });

  // Honeypot field - bots will fill this, humans won't see it
  const [honeypot, setHoneypot] = useState('');

  const selectedSubject = watch('subject');

  const onSubmit = async (data: ContactFormData) => {
    setIsLoading(true);

    try {
      const { queued, data: result } = await submitWithSync<{ success: boolean; message: string }>(
        '/api/contact',
        { ...data, website: honeypot, _t: formLoadedAt },
      );

      if (queued) {
        setSubmitted(true);
        showInfo(t('offlineQueued'));
        reset();
      } else if (result?.success) {
        setSubmitted(true);
        showSuccess(result.message);
        reset();
      } else {
        showError(result?.message || t('sendFailed'));
      }
    } catch {
      showError(t('sendFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-foreground mb-2">{t('form.successHeading')}</h3>
        <p className="text-muted-foreground mb-6">
          {t('form.successBody')}
        </p>
        <button
          onClick={() => setSubmitted(false)}
          className="px-4 py-2.5 min-h-[44px] text-primary hover:bg-primary/10 rounded-lg transition-colors"
        >
          {t('form.sendAnother')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Honeypot - hidden from humans, bots will fill it */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
        <label htmlFor="website">Website</label>
        <input
          type="text"
          id="website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-foreground mb-2">
            {t('form.nameLabel')} <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            id="name"
            {...register('name')}
            className={`w-full px-4 py-3 border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
              errors.name ? 'border-destructive' : 'border-input'
            }`}
            placeholder={t('form.namePlaceholder')}
          />
          {errors.name && (
            <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
            {t('form.emailLabel')} <span className="text-destructive">*</span>
          </label>
          <input
            type="email"
            id="email"
            {...register('email')}
            className={`w-full px-4 py-3 border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
              errors.email ? 'border-destructive' : 'border-input'
            }`}
            placeholder={t('form.emailPlaceholder')}
          />
          {errors.email && (
            <p className="mt-1 text-sm text-destructive">{errors.email.message}</p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="subject" className="block text-sm font-medium text-foreground mb-2">
          {t('form.subjectLabel')} <span className="text-destructive">*</span>
        </label>
        <select
          id="subject"
          {...register('subject')}
          className={`w-full px-4 py-3 border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
            errors.subject ? 'border-destructive' : 'border-input'
          }`}
        >
          {/* Option values stay English — they are submitted to /api/contact. */}
          <option value="">{t('form.subjectSelect')}</option>
          <option value="General Inquiry">{t('form.subjectGeneral')}</option>
          <option value="Order Status">{t('form.subjectOrderStatus')}</option>
          <option value="Returns & Refunds">{t('form.subjectReturns')}</option>
          <option value="Product Question">{t('form.subjectProduct')}</option>
          <option value="Technical Support">{t('form.subjectTechnical')}</option>
          <option value="Feedback">{t('form.subjectFeedback')}</option>
          <option value="Other">{t('form.subjectOther')}</option>
        </select>
        {errors.subject && (
          <p className="mt-1 text-sm text-destructive">{errors.subject.message}</p>
        )}
      </div>

      {selectedSubject === 'Order Status' && (
        <div className="space-y-4 p-4 bg-muted/50 border border-border rounded-lg">
          <p className="text-sm text-muted-foreground">
            {t('form.orderInfoPrompt')}
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="orderNumber" className="block text-sm font-medium text-foreground mb-2">
                {t('form.orderNumberLabel')}
              </label>
              <input
                type="text"
                id="orderNumber"
                {...register('orderNumber')}
                className="w-full px-4 py-3 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                placeholder={t('form.orderNumberPlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="orderLastName" className="block text-sm font-medium text-foreground mb-2">
                {t('form.orderLastNameLabel')}
              </label>
              <input
                type="text"
                id="orderLastName"
                {...register('orderLastName')}
                className="w-full px-4 py-3 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                placeholder={t('form.orderLastNamePlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="orderEmail" className="block text-sm font-medium text-foreground mb-2">
                {t('form.orderEmailLabel')}
              </label>
              <input
                type="email"
                id="orderEmail"
                {...register('orderEmail')}
                className="w-full px-4 py-3 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                placeholder={t('form.orderEmailPlaceholder')}
              />
            </div>
          </div>
          {errors.orderNumber && (
            <p className="text-sm text-destructive">{errors.orderNumber.message}</p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="message" className="block text-sm font-medium text-foreground mb-2">
          {t('form.messageLabel')} <span className="text-destructive">*</span>
        </label>
        <textarea
          id="message"
          {...register('message')}
          rows={6}
          className={`w-full px-4 py-3 border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none ${
            errors.message ? 'border-destructive' : 'border-input'
          }`}
          placeholder={t('form.messagePlaceholder')}
        />
        {errors.message && (
          <p className="mt-1 text-sm text-destructive">{errors.message.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-4 px-6 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            {t('form.sending')}
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {t('form.send')}
          </>
        )}
      </button>
    </form>
  );
}
