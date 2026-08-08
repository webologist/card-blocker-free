// api/user-directory.js
// Records phone -> email server-side, so login/registration emails can be sent
// even though the live site keeps its user records in the visitor's own
// browser (there is no /api/storage in production - see EMAIL-SETUP.md).
//
// A caller must present a phoneToken issued by /api/verify-otp, which is only
// handed out after the server itself verified that phone. Without it, anyone
// could register a stranger's address against any number and make the app mail
// them.
const { createClient } = require('@supabase/supabase-js');
const { verifyPhoneToken } = require('../lib/phone-token');

const ALLOWED_ORIGINS = ['https://card-blocker.vercel.app', 'https://card-blocker-free.vercel.app', 'http://localhost:3000', 'http://localhost:3001'];

function supabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(url, key);
}

function isValidEmail(e) {
  return typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'Origin not allowed' });
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phoneToken, email, name } = req.body || {};

  // The phone comes from the signed token, never from the request body - that
  // is the whole point of this endpoint.
  const phone = await verifyPhoneToken(phoneToken);
  if (!phone) return res.status(401).json({ error: 'Missing or expired phone verification.' });

  if (email !== '' && !isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const digits = phone.replace(/\D/g, '').replace(/^91/, '');

  try {
    const supabase = supabaseClient();
    const { error } = await supabase.from('user_directory').upsert({
      phone: digits,
      email: email || null,
      name: typeof name === 'string' ? name.slice(0, 100) : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone' });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[user-directory] error:', e.message);
    return res.status(500).json({ error: 'Could not save.' });
  }
}
