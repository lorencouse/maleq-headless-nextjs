'use client';

import { useState } from 'react';
import { toast } from 'react-hot-toast';

interface CommentFormProps {
  postId: number;
  onCommentSubmitted?: () => void;
}

export default function CommentForm({
  postId,
  onCommentSubmitted,
}: CommentFormProps) {
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
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.errors) {
          setErrors(data.errors);
        } else {
          toast.error(data.message || 'Failed to submit comment');
        }
        return;
      }

      // Success
      toast.success(data.message || 'Comment submitted successfully!');
      setIsSubmitted(true);
      setFormData({ author: '', email: '', content: '' });
      onCommentSubmitted?.();
    } catch (error) {
      console.error('Comment submission error:', error);
      toast.error('Failed to submit comment. Please try again.');
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
          Thank you for your comment!
        </h3>
        <p className='text-muted-foreground'>
          Your comment has been submitted and is awaiting moderation.
        </p>
        <button
          onClick={() => setIsSubmitted(false)}
          className='mt-4 text-primary hover:text-primary-hover font-medium'
        >
          Leave another comment
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-4'>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
        {/* Name */}
        <div>
          <label
            htmlFor='author'
            className='block text-sm font-medium text-foreground mb-1'
          >
            Name <span className='text-destructive'>*</span>
          </label>
          <input
            type='text'
            id='author'
            name='author'
            value={formData.author}
            onChange={handleChange}
            className={`w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
              errors.author ? 'border-destructive' : 'border-border'
            }`}
            placeholder='Your name'
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
            Email <span className='text-destructive'>*</span>
          </label>
          <input
            type='email'
            id='email'
            name='email'
            value={formData.email}
            onChange={handleChange}
            className={`w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
              errors.email ? 'border-destructive' : 'border-border'
            }`}
            placeholder='your@email.com'
          />
          {errors.email && (
            <p className='mt-1 text-sm text-destructive'>{errors.email}</p>
          )}
          <p className='mt-1 text-xs text-muted-foreground'>
            Your email will not be published.
          </p>
        </div>
      </div>

      {/* Comment */}
      <div>
        <label
          htmlFor='content'
          className='block text-sm font-medium text-foreground mb-1'
        >
          Comment <span className='text-destructive'>*</span>
        </label>
        <textarea
          id='content'
          name='content'
          value={formData.content}
          onChange={handleChange}
          rows={5}
          className={`w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-y ${
            errors.content ? 'border-destructive' : 'border-border'
          }`}
          placeholder='Share your thoughts...'
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
      <button
        type='submit'
        disabled={isSubmitting}
        className='px-6 py-2 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
      >
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
            Submitting...
          </span>
        ) : (
          'Post Comment'
        )}
      </button>
    </form>
  );
}
