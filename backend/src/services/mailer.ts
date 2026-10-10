import nodemailer from 'nodemailer';
import { log } from '../utils/logger';

// SMTP_URL e.g. smtps://user:app-password@smtp.gmail.com:465. Without it, mails are not sent and the
// link is written to the backend log instead, so password reset still works for the site owner.
const SMTP_URL = process.env.SMTP_URL || '';
const MAIL_FROM = process.env.MAIL_FROM || 'NovelHub <no-reply@novelhub.local>';
export const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const transport = SMTP_URL ? nodemailer.createTransport(SMTP_URL) : null;

export const mailConfigured = () => Boolean(transport);

/** Send a short mail with one action link. Never throws: callers must not leak whether it worked. */
export async function sendLinkMail(to: string, subject: string, intro: string, linkText: string, link: string) {
  if (!transport) {
    // The one deliberate unredacted line: without SMTP the site owner reads reset/verify links here (dev only)
    log('warn', `[mail] SMTP_URL not set; would send "${subject}" to ${to}: ${link}`, {}, true);
    return;
  }
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  try {
    await transport.sendMail({
      from: MAIL_FROM,
      to,
      subject,
      text: `${intro}\n\n${linkText}: ${link}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
      html: `<p>${esc(intro)}</p><p><a href="${esc(link)}">${esc(linkText)}</a></p>`
        + `<p style="color:#888;font-size:12px">Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>`,
    });
  } catch (err: any) {
    console.error(`[mail] sending "${subject}" failed: ${err.message}`);
  }
}
