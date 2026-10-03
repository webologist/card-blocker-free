import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyCors } = require('../../lib/cors');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkAdminAccess } = require('../../lib/admin-auth');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSupabaseServerClient } = require('../../lib/supabase-server');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sanitizeError } = require('../../lib/input-validator');

// Vercel copy of server.js's GET /api/contact-messages, added 4 Oct 2026.
// The admin console's "Contact messages" panel (admin-contact-messages.js)
// has always called this URL, but only server.js ever implemented it - on
// the deployed site the route did not exist, so the panel could only ever
// show a failure. Mirrors server.js: admin-only, newest first, capped.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await checkAdminAccess(req);
  // 403 to match server.js - the panel treats 401 and 403 alike.
  if (!auth.ok) return res.status(403).json({ error: auth.error });

  const supabase = getSupabaseServerClient();
  if (!supabase) return res.status(503).json({ error: 'Storage is not configured on this deployment.' });

  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const limit = Math.min(parseInt(String(rawLimit || ''), 10) || 100, 500);

  try {
    const { data, error } = await supabase.from('kv_store').select('key,value').like('key', 'contact:%');
    if (error) throw new Error(error.message);
    const messages: any[] = [];
    for (const row of data || []) {
      let v: any;
      try { v = JSON.parse(row.value); } catch (e) { continue; }
      messages.push({
        key: row.key,
        name: v.name || '', mobile: v.mobile || '', email: v.email || '',
        subject: v.subject || '', brief: v.brief || '',
        received_at: v.received_at || '', ip: v.ip || '',
      });
    }
    // Newest first; the key embeds the ISO timestamp so it sorts reliably.
    messages.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    return res.status(200).json({ count: messages.length, messages: messages.slice(0, limit) });
  } catch (error) {
    console.error('[CONTACT-MESSAGES] Error:', error);
    return res.status(500).json({ error: sanitizeError(error) });
  }
}
