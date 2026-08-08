const { createClient } = require('@supabase/supabase-js');
const { checkAdminKey } = require('../../lib/admin-auth');
const { getSettings, saveSettings } = require('../../lib/email-settings-store');
const { maskSettings } = require('../../lib/email-providers');

const ALLOWED_ORIGINS = ['https://card-blocker.vercel.app', 'https://card-blocker-free.vercel.app', 'http://localhost:3000', 'http://localhost:3001'];

function supabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(url, key);
}

// Only these fields may be written, and only when non-empty (an empty/omitted
// secret field means "leave the existing value alone", so re-saving a from-name
// doesn't blank out an already-saved API key).
const WRITABLE_FIELDS = [
  'active_provider',
  'brevo_api_key', 'brevo_from_email', 'brevo_from_name',
  'ses_access_key_id', 'ses_secret_access_key', 'ses_region', 'ses_from_email',
  'gmail_address', 'gmail_app_password', 'gmail_from_name',
];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'Origin not allowed' });
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = checkAdminKey(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const supabase = supabaseClient();

  if (req.method === 'GET') {
    try {
      const row = await getSettings(supabase);
      return res.status(200).json(maskSettings(row));
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const patch = {};
    for (const f of WRITABLE_FIELDS) {
      if (body[f] !== undefined && body[f] !== '') patch[f] = body[f];
    }
    if (body.active_provider === null) patch.active_provider = null; // explicit "turn off"
    try {
      const row = await saveSettings(supabase, patch);
      return res.status(200).json(maskSettings(row));
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
