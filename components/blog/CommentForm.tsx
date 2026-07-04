'use client';

import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import Button from '@/components/ui/Button';

interface CommentFormProps {
  postId: number;
  onCommentSubmitted?: () => void;
}

export default function CommentForm({
  postId,
  onCommentSubmitted,
}: CommentFormProps) {
  const t = useTranslations('blogComments');
  const [formLoadedAt] = useState(() => Date.now());
  const [honeypot, setHoneypot] = useState('');
  const [formData, setFormData] = useState({
    author: '',
    email: '',
    content: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrors({});

    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postId,
          ...formData,
          website: honeypot,
          _t: formLoadedAt,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.errors) {
          setErrors(data.errors);
        } else {
          toast.error(data.message || t('toastFailure'));
        }
        return;
      }

      // Success
      toast.success(data.message || t('toastSuccess'));
      setIsSubmitted(true);
      setFormData({ author: '', email: '', content: '' });
      onCommentSubmitted?.();
    } catch (error) {
      console.error('Comment submission error:', error);
      toast.error(t('toastRetry'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className='bg-success/10 border border-success rounded-lg p-6 text-center'>
        <svg
          className='w-12 h-12 text-success mx-auto mb-3'
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={2}
            d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
          />
        </svg>
        <h3 className='text-lg font-semibold text-foreground mb-2'>
          {t('thankYouHeading')}
        </h3>
        <p className='text-muted-foreground'>
          {t('thankYouMessage')}
        </p>
        <button
          onClick={() => setIsSubmitted(false)}
          className='mt-4 px-4 py-2.5 min-h-[44px] text-primary hover:bg-primary/10 rounded-lg text-xs font-bold uppercase tracking-[0.12em] transition-colors'
        >
          {t('leaveAnother')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-4'>
      {/* Honeypot - hidden from humans, bots will fill it */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
        <label htmlFor="comment-website">{t('honeypotLabel')}</label>
        <input
          type="text"
          id="comment-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
        {/* Name */}
        <div>
          <label
            htmlFor='author'
            className='block text-sm font-medium text-foreground mb-1'
          >
            {t('nameLabel')} <span className='text-destructive'>*</span>
          </label>
          <input
            type='text'
            id='author'
            name='author'
            value={formData.author}
            onChange={handleChange}
            className={`w-full px-4 py-2.5 min-h-[44px] border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
              errors.author ? 'border-destructive' : 'border-border'
            }`}
            placeholder={t('namePlaceholder')}
          />
          {errors.author && (
            <p className='mt-1 text-sm text-destructive'>{errors.author}</p>
          )}
        </div>

        {/* Email */}
        <div>
          <label
            htmlFor='email'
            className='block text-sm font-medium text-foreground mb-1'
          >
            {t('emailLabel')} <span className='text-destructive'>*</span>
          </label>
          <input
            type='email'
            id='email'
            name='email'
            value={formData.email}
            onChange={handleChange}
            className={`w-full px-4 py-2.5 min-h-[44px] border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
              errors.email ? 'border-destructive' : 'border-border'
            }`}
            placeholder={t('emailPlaceholder')}
          />
          {errors.email && (
            <p className='mt-1 text-sm text-destructive'>{errors.email}</p>
          )}
          <p className='mt-1 text-xs text-muted-foreground'>
            {t('emailNotPublished')}
          </p>
        </div>
      </div>

      {/* Comment */}
      <div>
        <label
          htmlFor='content'
          className='block text-sm font-medium text-foreground mb-1'
        >
          {t('commentLabel')} <span className='text-destructive'>*</span>
        </label>
        <textarea
          id='content'
          name='content'
          value={formData.content}
          onChange={handleChange}
          rows={5}
          className={`w-full px-4 py-2.5 border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-y ${
            errors.content ? 'border-destructive' : 'border-border'
          }`}
          placeholder={t('commentPlaceholder')}
        />
        {errors.content && (
          <p className='mt-1 text-sm text-destructive'>{errors.content}</p>
        )}
      </div>

      {/* General error */}
      {errors.general && (
        <div className='bg-destructive/10 border border-destructive rounded-lg p-3'>
          <p className='text-sm text-destructive'>{errors.general}</p>
        </div>
      )}

      {/* Submit button */}
      <Button type='submit' size='lg' disabled={isSubmitting}>
        {isSubmitting ? (
          <span className='flex items-center gap-2'>
            <svg
              className='animate-spin h-4 w-4'
              xmlns='http://www.w3.org/2000/svg'
              fill='none'
              viewBox='0 0 24 24'
            >
              <circle
                className='opacity-25'
                cx='12'
                cy='12'
                r='10'
                stroke='currentColor'
                strokeWidth='4'
              />
              <path
                className='opacity-75'
                fill='currentColor'
                d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
              />
            </svg>
            {t('submitting')}
          </span>
        ) : (
          t('submitButton')
        )}
      </Button>
    </form>
  );
}
