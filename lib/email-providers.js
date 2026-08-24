// lib/email-providers.js
// Shared server-side email sending for the three providers an admin can connect:
// Brevo (HTTP API), AWS SES (SDK), Gmail (SMTP + App Password).
// Used by both server.js (local/Express) and the Vercel serverless functions in /api.

async function sendViaBrevo(cfg, { to, subject, html, text }) {
  if (!cfg.brevo_api_key) throw new Error('Brevo API key is not set.');
  if (!cfg.brevo_from_email) throw new Error('Brevo sender email is not set.');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': cfg.brevo_api_key,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: cfg.brevo_from_email, name: cfg.brevo_from_name || 'BlockMyCard' },
      to: [{ email: to }],
      subject,
      htmlContent: html || `<p>${text}</p>`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo error (${res.status}): ${body.slice(0, 300)}`);
  }
  // Brevo returns 201 + a messageId even when it will later bounce/block the
  // message silently on their side - capturing it is the only way to look up
  // what actually happened in Brevo's own transactional log after the fact.
  const data = await res.json().catch(() => ({}));
  return { messageId: data.messageId };
}

async function sendViaSes(cfg, { to, subject, html, text }) {
  if (!cfg.ses_access_key_id || !cfg.ses_secret_access_key) throw new Error('AWS SES access key/secret is not set.');
  if (!cfg.ses_from_email) throw new Error('AWS SES sender email is not set.');
  const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
  const client = new SESClient({
    region: cfg.ses_region || 'us-east-1',
    credentials: {
      accessKeyId: cfg.ses_access_key_id,
      secretAccessKey: cfg.ses_secret_access_key,
    },
  });
  await client.send(new SendEmailCommand({
    Source: cfg.ses_from_email,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject },
      Body: html ? { Html: { Data: html } } : { Text: { Data: text || '' } },
    },
  }));
}

async function sendViaGmail(cfg, { to, subject, html, text }) {
  if (!cfg.gmail_address || !cfg.gmail_app_password) throw new Error('Gmail address/app password is not set.');
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: cfg.gmail_address, pass: cfg.gmail_app_password },
  });
  await transporter.sendMail({
    from: `"${cfg.gmail_from_name || 'BlockMyCard'}" <${cfg.gmail_address}>`,
    to,
    subject,
    html,
    text,
  });
}

const SENDERS = { brevo: sendViaBrevo, ses: sendViaSes, gmail: sendViaGmail };

// cfg: the full row from email_settings. provider: optional override, else cfg.active_provider.
async function sendEmail(cfg, provider, message) {
  const p = provider || cfg.active_provider;
  if (!p || !SENDERS[p]) throw new Error('No email provider is connected/active.');
  const result = await SENDERS[p](cfg, message);
  return Object.assign({ provider: p }, result);
}

// Never send raw secrets to the browser - only enough to show "configured" state.
function maskSecret(v) {
  if (!v) return null;
  return v.length <= 4 ? '••••' : '••••' + v.slice(-4);
}

function maskSettings(row) {
  if (!row) {
    return {
      active_provider: null,
      brevo: { configured: false, from_email: null, from_name: null, key_hint: null },
      ses: { configured: false, from_email: null, region: null, key_hint: null },
      gmail: { configured: false, address: null, from_name: null },
    };
  }
  return {
    active_provider: row.active_provider || null,
    brevo: {
      configured: !!row.brevo_api_key,
      from_email: row.brevo_from_email || null,
      from_name: row.brevo_from_name || null,
      key_hint: maskSecret(row.brevo_api_key),
    },
    ses: {
      configured: !!(row.ses_access_key_id && row.ses_secret_access_key),
      from_email: row.ses_from_email || null,
      region: row.ses_region || null,
      key_hint: maskSecret(row.ses_access_key_id),
    },
    gmail: {
      configured: !!(row.gmail_address && row.gmail_app_password),
      address: row.gmail_address || null,
      from_name: row.gmail_from_name || null,
    },
  };
}

module.exports = { sendEmail, maskSettings };
