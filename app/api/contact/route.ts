import { NextRequest } from 'next/server';
import {
  successResponse,
  validationError,
  handleApiError,
} from '@/lib/api/response';
import {
  validateEmail,
  validateLength,
  hasErrors,
} from '@/lib/api/validation';

interface ContactFormData {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: ContactFormData = await request.json();
    const { name, email, subject, message } = body;

    // Validate required fields
    const errors: Record<string, string> = {};

    if (!name || !name.trim()) {
      errors.name = 'Name is required';
    }

    // Validate email format
    const emailError = validateEmail(email);
    if (emailError) {
      errors.email = emailError;
    }

    if (!subject || !subject.trim()) {
      errors.subject = 'Subject is required';
    }

    if (!message || !message.trim()) {
      errors.message = 'Message is required';
    } else {
      const lengthError = validateLength(message, 'message', 10);
      if (lengthError) {
        errors.message = lengthError;
      }
    }

    if (hasErrors(errors)) {
      return validationError(errors);
    }

    // In production, integrate with your email service:
    // - SendGrid
    // - Mailgun
    // - AWS SES
    // - WordPress admin email via REST API

    // For development, log the contact form submission
    if (process.env.NODE_ENV === 'development') {
      console.log('Contact form submission:', {
        name: name.trim(),
        email: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
        timestamp: new Date().toISOString(),
      });
    }

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    return successResponse(
      undefined,
      "Thank you for your message! We'll get back to you soon."
    );
  } catch (error) {
    return handleApiError(error, 'Failed to send message. Please try again.');
  }
}
