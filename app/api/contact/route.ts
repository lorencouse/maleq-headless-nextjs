import { NextRequest } from 'next/server';
import nodemailer from 'nodemailer';
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

const transporter = nodemailer.createTransport({
  host: 'smtp.mail.me.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USERNAME,
    pass: process.env.SMTP_PASSWORD,
  },
});

export async function POST(request: NextRequest) {
  try {
    const body: ContactFormData = await request.json();
    const { name, email, subject, message } = body;

    // Validate required fields
    const errors: Record<string, string> = {};

    if (!name || !name.trim()) {
      errors.name = 'Name is required';
    }

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

    const sanitizedName = name.trim();
    const sanitizedEmail = email.trim();
    const sanitizedSubject = subject.trim();
    const sanitizedMessage = message.trim();

    await transporter.sendMail({
      from: `"Male Q Contact Form" <info@maleq.com>`,
      to: 'info@maleq.com',
      replyTo: `"${sanitizedName}" <${sanitizedEmail}>`,
      subject: `Contact Form: ${sanitizedSubject}`,
      text: [
        `Name: ${sanitizedName}`,
        `Email: ${sanitizedEmail}`,
        `Subject: ${sanitizedSubject}`,
        '',
        'Message:',
        sanitizedMessage,
      ].join('\n'),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px;">
          <h2 style="color: #E63946; margin-bottom: 20px;">New Contact Form Submission</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 8px 12px; font-weight: bold; color: #555; width: 80px;">Name:</td>
              <td style="padding: 8px 12px;">${sanitizedName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; font-weight: bold; color: #555;">Email:</td>
              <td style="padding: 8px 12px;"><a href="mailto:${sanitizedEmail}">${sanitizedEmail}</a></td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; font-weight: bold; color: #555;">Subject:</td>
              <td style="padding: 8px 12px;">${sanitizedSubject}</td>
            </tr>
          </table>
          <div style="padding: 16px; background: #f5f5f5; border-radius: 8px; white-space: pre-wrap;">${sanitizedMessage}</div>
        </div>
      `,
    });

    return successResponse(
      undefined,
      "Thank you for your message! We'll get back to you soon."
    );
  } catch (error) {
    console.error('Contact form email error:', error);
    return handleApiError(error, 'Failed to send message. Please try again.');
  }
}
