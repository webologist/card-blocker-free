// lib/email-settings-store.js
// Reads/writes the single email_settings row (id=1) and the login_email_log
// idempotency table, via a Supabase service-role client passed in by the caller.
// Also the single source of truth for the writable-field whitelist and the
// login-email content/rate-limit, shared by server.js and pages/api/*.ts so
// the two entry points can't quietly drift apart.

const { checkAndRecord } = require('./rate-limit-store');

const WRITABLE_EMAIL_FIELDS = [
  'active_provider',
  'brevo_api_key', 'brevo_from_email', 'brevo_from_name',
  'ses_access_key_id', 'ses_secret_access_key', 'ses_region', 'ses_from_email',
  'gmail_address', 'gmail_app_password', 'gmail_from_name',
];

async function getSettings(supabase) {
  const { data, error } = await supabase.from('email_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Only overwrites fields present in `patch` - lets the admin update one
// provider's from-name without retyping another provider's secret.
async function saveSettings(supabase, patch) {
  const row = { id: 1, ...patch, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('email_settings').upsert(row, { onConflict: 'id' });
  if (error) throw error;
  return getSettings(supabase);
}

// Atomic "have we already emailed this login" check via the (phone, ts)
// primary key - an insert that succeeds means this is the first time we've
// seen this exact login log entry; a conflict means a duplicate poll/tab.
async function claimLoginEmail(supabase, phone, ts) {
  const { error } = await supabase.from('login_email_log').insert({ phone, ts });
  if (error) {
    if (error.code === '23505') return false; // unique_violation - already claimed
    throw error;
  }
  return true;
}

// Backstop so a burst of retries (e.g. a signup racing to add its email
// right after registering) can't be used to spam a single inbox.
async function isLoginEmailRateLimited(supabase, phone) {
  const result = await checkAndRecord(supabase, 'login-email', phone, 5 * 60 * 1000, 15);
  return result.limited;
}

// Wording differs by event: a signup is expected and reassuring, a login on
// an existing account is the one worth flagging as "wasn't you?".
function buildLoginEmailMessage(event, user, phone, ts) {
  const greeting = `Hi${user.name ? ' ' + user.name : ''},`;
  if (event === 'registered') {
    return {
      subject: 'Welcome to BlockMyCard — your cards are saved',
      html: `<p>${greeting}</p><p>Your BlockMyCard account (${phone}) was created on ${ts}.</p><p>You can now save your card details so you can block them quickly if your wallet or phone is ever lost.</p>`,
      text: `Your BlockMyCard account (${phone}) was created on ${ts}. You can now save your card details so you can block them quickly if your wallet or phone is ever lost.`,
    };
  }
  return {
    subject: 'Security alert: new sign-in to BlockMyCard',
    html: `<p>${greeting}</p><p>Your BlockMyCard account (${phone}) was just logged into at ${ts}.</p><p>If this wasn't you, we recommend checking your saved cards and contact details right away.</p>`,
    text: `Your BlockMyCard account (${phone}) was just logged into at ${ts}. If this wasn't you, check your saved cards and contact details.`,
  };
}

module.exports = {
  getSettings, saveSettings, claimLoginEmail,
  WRITABLE_EMAIL_FIELDS, isLoginEmailRateLimited, buildLoginEmailMessage,
};
