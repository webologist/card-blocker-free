import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyCors } = require('../../lib/cors');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  getSettings, claimLoginEmail, isLoginEmailRateLimited, buildLoginEmailMessage,
} = require('../../lib/email-settings-store');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendEmail } = require('../../lib/email-providers');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSupabaseServerClient } = require('../../lib/supabase-server');

// Vercel copy of server.js's /api/login-email - see EMAIL-SETUP.md and
// login-email-notifier.js (the client that polls cbp:logs and calls this).
// Every path here answers { ok: true } even on failure - a broken email
// provider must never surface as a login problem to the caller.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, ts, event } = (req.body || {}) as { phone?: string; ts?: string; event?: string };
  if (!phone || !ts) return res.status(200).json({ ok: true, sent: false, reason: 'bad-request' });

  const supabase = getSupabaseServerClient();
  if (!supabase) return res.status(200).json({ ok: true, sent: false, reason: 'not-configured' });

  if (await isLoginEmailRateLimited(supabase, phone)) {
    return res.status(200).json({ ok: true, sent: false, reason: 'rate-limited' });
  }

  try {
    // Look up before claiming, so a signup whose email has not been entered
    // yet can still be retried once it is.
    const cfg = await getSettings(supabase);
    if (!cfg || !cfg.active_provider) return res.status(200).json({ ok: true, sent: false, reason: 'no-provider' });

    const { data: dir } = await supabase
      .from('user_directory').select('email, name').eq('phone', phone).maybeSingle();
    let user = dir && dir.email ? dir : null;
    if (!user) {
      const { data } = await supabase.from('kv_store').select('value').eq('key', 'cbp:users').single();
      if (data) {
        try { user = JSON.parse(data.value)[phone] || null; } catch (e) { user = null; }
      }
    }
    if (!user || !user.email) return res.status(200).json({ ok: true, sent: false, reason: 'no-email' });

    const claimed = await claimLoginEmail(supabase, phone, String(ts));
    if (!claimed) return res.status(200).json({ ok: true, sent: false, reason: 'duplicate' });

    await sendEmail(cfg, null, Object.assign({ to: user.email }, buildLoginEmailMessage(event, user, phone, ts)));
    return res.status(200).json({ ok: true, sent: true });
  } catch (error: any) {
    console.error('[LOGIN-EMAIL] error:', error.message);
    return res.status(200).json({ ok: true });
  }
}
