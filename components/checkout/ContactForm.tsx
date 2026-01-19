'use client';

import { useState } from 'react';

interface ContactFormProps {
  onComplete: (data: { email: string; phone: string; newsletter: boolean }) => void;
}

export default function ContactForm({ onComplete }: ContactFormProps) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [newsletter, setNewsletter] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

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

    if (!email) {
      newErrors.email = 'Email is required';
    } else if (!validateEmail(email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (phone && !validatePhone(phone)) {
      newErrors.phone = 'Please enter a valid phone number';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      onComplete({ email, phone, newsletter });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Email */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
          Email Address <span className="text-red-500">*</span>
        </label>
        <input
          type="email"
          id="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground ${
            errors.email ? 'border-red-500' : 'border-input'
          }`}
        />
        {errors.email && (
          <p className="mt-1 text-sm text-red-500">{errors.email}</p>
        )}
      </div>

      {/* Phone (Optional) */}
      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-foreground mb-1">
          Phone Number <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          type="tel"
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 123-4567"
          className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground ${
            errors.phone ? 'border-red-500' : 'border-input'
          }`}
        />
        {errors.phone && (
          <p className="mt-1 text-sm text-red-500">{errors.phone}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          For delivery updates and questions about your order
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
          Email me with news and offers
        </label>
      </div>

      {/* Continue Button */}
      <button
        type="submit"
        className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold"
      >
        Continue to Shipping
      </button>
    </form>
  );
}
