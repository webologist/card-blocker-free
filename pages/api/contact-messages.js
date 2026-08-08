// api/contact-messages.js
// Reads back the contact-form submissions that api/contact.js stores in
// kv_store under contact:<timestamp> keys.
//
// Those rows existed as a safety net - every message is written to the
// database before the email is attempted, so a missing or broken email
// provider cannot lose one - but nothing in the app could read them. The
// safety net was real and completely unreachable: if Brevo ever failed, the
// message survived somewhere only a direct database query could get to, while
// the sender was still shown a success message.
//
// Admin-gated by the same shared secret as the email-integration endpoints.

const { createClient } = require('@supabase/supabase-js');
const { checkAdminAccess } = require('../lib/admin-auth');

const ALLOWED_ORIGINS = ['https://card-blocker.vercel.app', 'https://card-blocker-free.vercel.app', 'http://localhost:3000', 'http://localhost:3001'];
const MAX_LIMIT = 500;

function supabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'Origin not allowed' });
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key, x-phone-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await checkAdminAccess(req);
  if (!admin.ok) return res.status(403).json({ error: admin.error });

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, MAX_LIMIT);

  const sb = supabaseClient();
  const { data, error } = await sb.from('kv_store').select('key,value').like('key', 'contact:%');
  if (error) return res.status(500).json({ error: error.message });

  const messages = [];
  for (const row of data || []) {
    let v;
    try { v = JSON.parse(row.value); } catch { continue; }
    messages.push({
      key: row.key,
      name: v.name || '',
      mobile: v.mobile || '',
      email: v.email || '',
      subject: v.subject || '',
      brief: v.brief || '',
      received_at: v.received_at || '',
      ip: v.ip || '',
    });
  }

  // Newest first. The key embeds the ISO timestamp, so it sorts correctly even
  // for rows whose stored received_at is missing or malformed.
  messages.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));

  return res.status(200).json({ count: messages.length, messages: messages.slice(0, limit) });
}
