'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { showSuccess, showError } from '@/lib/utils/toast';
import { contactSchema, type ContactFormData } from '@/lib/validations/contact';

export default function ContactForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: '',
      email: '',
      subject: '',
      message: '',
    },
  });

  const onSubmit = async (data: ContactFormData) => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.success) {
        setSubmitted(true);
        showSuccess(result.message);
        reset();
      } else {
        showError(result.message);
      }
    } catch {
      showError('Failed to send message. Please try again.');
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
        <h3 className="text-xl font-semibold text-foreground mb-2">Message Sent!</h3>
        <p className="text-muted-foreground mb-6">
          Thank you for reaching out. We&apos;ll get back to you as soon as possible.
        </p>
        <button
          onClick={() => setSubmitted(false)}
          className="text-primary hover:underline"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-foreground mb-2">
            Name <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            id="name"
            {...register('name')}
            className={`w-full px-4 py-3 border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
              errors.name ? 'border-destructive' : 'border-input'
            }`}
            placeholder="Your name"
          />
          {errors.name && (
            <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
            Email <span className="text-destructive">*</span>
          </label>
          <input
            type="email"
            id="email"
            {...register('email')}
            className={`w-full px-4 py-3 border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
              errors.email ? 'border-destructive' : 'border-input'
            }`}
            placeholder="your@email.com"
          />
          {errors.email && (
            <p className="mt-1 text-sm text-destructive">{errors.email.message}</p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="subject" className="block text-sm font-medium text-foreground mb-2">
          Subject <span className="text-destructive">*</span>
        </label>
        <select
          id="subject"
          {...register('subject')}
          className={`w-full px-4 py-3 border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
            errors.subject ? 'border-destructive' : 'border-input'
          }`}
        >
          <option value="">Select a subject</option>
          <option value="General Inquiry">General Inquiry</option>
          <option value="Order Status">Order Status</option>
          <option value="Returns & Refunds">Returns & Refunds</option>
          <option value="Product Question">Product Question</option>
          <option value="Technical Support">Technical Support</option>
          <option value="Feedback">Feedback</option>
          <option value="Other">Other</option>
        </select>
        {errors.subject && (
          <p className="mt-1 text-sm text-destructive">{errors.subject.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="message" className="block text-sm font-medium text-foreground mb-2">
          Message <span className="text-destructive">*</span>
        </label>
        <textarea
          id="message"
          {...register('message')}
          rows={6}
          className={`w-full px-4 py-3 border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none ${
            errors.message ? 'border-destructive' : 'border-input'
          }`}
          placeholder="How can we help you?"
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
            Sending...
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Send Message
          </>
        )}
      </button>
    </form>
  );
}
