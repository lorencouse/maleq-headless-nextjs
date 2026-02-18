import nodemailer from 'nodemailer';

const ALERT_EMAIL = process.env.ALERT_EMAIL || 'info@maleq.com';

const transporter = nodemailer.createTransport({
  host: 'smtp.mail.me.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USERNAME,
    pass: process.env.SMTP_PASSWORD,
  },
});

interface AlertContext {
  [key: string]: string | number | undefined;
}

/**
 * Send an admin alert email for critical checkout/payment errors.
 * Fire-and-forget — errors are caught internally so this never breaks the caller.
 */
export function sendAdminAlert(
  subject: string,
  details: AlertContext
): void {
  const env = process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT';
  const timestamp = new Date().toISOString();

  const rows = Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(
      ([key, value]) =>
        `<tr>
          <td style="padding:6px 12px;font-weight:bold;color:#555;white-space:nowrap;">${key}</td>
          <td style="padding:6px 12px;">${String(value)}</td>
        </tr>`
    )
    .join('');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;">
      <div style="background:#dc3545;color:#fff;padding:12px 16px;border-radius:8px 8px 0 0;font-size:16px;font-weight:bold;">
        ⚠ ${env} Alert: ${subject}
      </div>
      <div style="border:1px solid #dc3545;border-top:none;border-radius:0 0 8px 8px;padding:16px;">
        <table style="width:100%;border-collapse:collapse;">
          ${rows}
          <tr>
            <td style="padding:6px 12px;font-weight:bold;color:#555;white-space:nowrap;">Timestamp</td>
            <td style="padding:6px 12px;">${timestamp}</td>
          </tr>
        </table>
      </div>
    </div>`;

  // Fire-and-forget
  transporter
    .sendMail({
      from: `"Male Q Alerts" <info@maleq.com>`,
      to: ALERT_EMAIL,
      subject: `[${env}] ${subject}`,
      html,
    })
    .catch((err) => {
      console.error('Failed to send admin alert email:', err);
    });
}
