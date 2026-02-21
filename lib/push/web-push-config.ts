import webpush from 'web-push';

let configured = false;

export function getWebPush(): typeof webpush {
  if (!configured) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:info@maleq.com';

    if (!publicKey || !privateKey) {
      throw new Error('VAPID keys not configured — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY');
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }

  return webpush;
}
