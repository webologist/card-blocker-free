// api/contact.js
// Receives contact-form submissions. The front-end "Contact us" widget that
// used to post here has been removed; the endpoint is kept for the stored
// history and any future form.
// Every message is stored in kv_store under a contact:<ts> key so nothing is
// lost, and is then emailed on to the support inbox through whichever provider
// the admin has connected in Email Integrations. Storing first is deliberate:
// if no provider is configured yet, or the send fails, the message survives.
const { createClient } = require('@supabase/supabase-js');
const { getSettings } = require('../lib/email-settings-store');
const { sendEmail } = require('../lib/email-providers');
const { validateContact, buildContactEmail, contactRecipient, storageKey } = require('../lib/contact');

const ALLOWED_ORIGINS = ['https://card-blocker.vercel.app', 'https://card-blocker-free.vercel.app', 'http://localhost:3000', 'http://localhost:3001'];

// Per-IP, since a contact form has no logged-in identity to key on.
const rateLimitMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const hits = (rateLimitMap.get(ip) || []).filter((t) => now - t < windowMs);
  if (hits.length >= 5) return true;
  hits.push(now);
  rateLimitMap.set(ip, hits);
  return false;
}

function supabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(url, key);
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'Origin not allowed' });
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};

  // Honeypot: only a bot fills the hidden "website" field. Answer as if it
  // worked so the bot has nothing to learn from being rejected.
  if (body.website) return res.status(200).json({ ok: true });

  // Limit before validating: the widget validates client-side, so anything
  // reaching here malformed is a non-browser caller worth throttling too.
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many messages sent. Please try again in a few minutes.' });
  }

  const { valid, errors, data } = validateContact(body);
  if (!valid) return res.status(400).json({ ok: false, error: errors[0] });

  const supabase = supabaseClient();
  const receivedAt = new Date().toISOString();

  try {
    await supabase.from('kv_store').upsert(
      { key: storageKey(receivedAt), value: JSON.stringify({ ...data, received_at: receivedAt, ip }) },
      { onConflict: 'key' }
    );
  } catch (e) {
    console.error('[contact] store error:', e.message);
    return res.status(500).json({ ok: false, error: 'Could not save your message.' });
  }

  // The message is safely stored by this point, so a missing or broken email
  // provider is not the sender's problem - report success either way.
  try {
    const cfg = await getSettings(supabase);
    const to = contactRecipient();
    if (cfg && cfg.active_provider && to) {
      await sendEmail(cfg, null, { to, ...buildContactEmail(data, receivedAt) });
    }
  } catch (e) {
    console.error('[contact] email error:', e.message);
  }

  return res.status(200).json({ ok: true });
}
