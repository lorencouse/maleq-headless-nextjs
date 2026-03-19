import nodemailer from 'nodemailer';

const ALERT_EMAIL = process.env.ALERT_EMAIL || 'info@maleq.com';
const ALERT_EMAIL_TIMEOUT_MS = Number(process.env.ALERT_EMAIL_TIMEOUT_MS || 5000);

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.mail.me.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USERNAME,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }

  return transporter;
}

function isAlertingConfigured(): boolean {
  return Boolean(process.env.SMTP_USERNAME && process.env.SMTP_PASSWORD && ALERT_EMAIL);
}

interface AlertContext {
  [key: string]: string | number | boolean | undefined;
}

function stringifyAlertValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return String(value);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Admin alert timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Send an admin alert email for critical checkout/payment errors.
 * The send is bounded by a timeout and errors are swallowed so this never breaks the caller.
 */
export async function sendAdminAlert(
  subject: string,
  details: AlertContext
): Promise<boolean> {
  if (!isAlertingConfigured()) {
    console.warn('Admin alert skipped: SMTP credentials are not configured');
    return false;
  }

  const env = process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT';
  const timestamp = new Date().toISOString();

  const rows = Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(
      ([key, value]) => {
        if (value === undefined) {
          return '';
        }

        return (
        `<tr>
          <td style="padding:6px 12px;font-weight:bold;color:#555;white-space:nowrap;">${key}</td>
          <td style="padding:6px 12px;">${stringifyAlertValue(value)}</td>
        </tr>`
        );
      }
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

  try {
    await withTimeout(
      getTransporter().sendMail({
      from: `"Male Q Alerts" <info@maleq.com>`,
      to: ALERT_EMAIL,
      subject: `[${env}] ${subject}`,
      html,
      }),
      ALERT_EMAIL_TIMEOUT_MS
    );
    return true;
  } catch (err) {
    console.error('Failed to send admin alert email:', err);
    return false;
  }
}
