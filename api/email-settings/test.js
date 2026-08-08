const { createClient } = require('@supabase/supabase-js');
const { checkAdminKey } = require('../../lib/admin-auth');
const { getSettings } = require('../../lib/email-settings-store');
const { sendEmail } = require('../../lib/email-providers');

const ALLOWED_ORIGINS = ['https://card-blocker.vercel.app', 'https://card-blocker-free.vercel.app', 'http://localhost:3000', 'http://localhost:3001'];

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = checkAdminKey(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const { to, provider } = req.body || {};
  if (!to) return res.status(400).json({ error: 'A recipient email ("to") is required.' });

  try {
    const cfg = await getSettings(supabaseClient());
    if (!cfg) return res.status(400).json({ error: 'No email provider has been configured yet.' });
    const result = await sendEmail(cfg, provider, {
      to,
      subject: 'BlockMyCard test email',
      html: '<p>This is a test email from your BlockMyCard admin console. If you got this, the connection works.</p>',
      text: 'This is a test email from your BlockMyCard admin console. If you got this, the connection works.',
    });
    return res.status(200).json({ success: true, provider: result.provider });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
