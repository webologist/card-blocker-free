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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyPhoneToken } = require('../../lib/phone-token');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { userKey, canonicalUsers } = require('../../lib/storage-policy');

// Vercel copy of server.js's /api/login-email - see EMAIL-SETUP.md and
// login-email-notifier.js (the client that polls cbp:logs and calls this).
// Every path here answers { ok: true } even on failure - a broken email
// provider must never surface as a login problem to the caller.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, ts, event, phoneToken } = (req.body || {}) as { phone?: string; ts?: string; event?: string; phoneToken?: string };
  if (!phone || !ts) return res.status(200).json({ ok: true, sent: false, reason: 'bad-request' });

  // FIX (4 Oct 2026): login-email-notifier.js has always sent the signed
  // phoneToken with this request, and says in its own comments that "the
  // server will not mail anyone on an unproven claim" - but this route never
  // looked at it. Anyone could POST { phone, ts } for any number and have the
  // site send that person a "Security alert: new sign-in" email, up to the
  // rate limit, with a different `ts` each time. The token must now be valid
  // and must belong to the number the email is about.
  let proven: string | null = null;
  try { proven = await verifyPhoneToken(phoneToken); } catch (e) { proven = null; }
  if (!proven || userKey(proven) !== userKey(phone)) {
    return res.status(200).json({ ok: true, sent: false, reason: 'unverified' });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return res.status(200).json({ ok: true, sent: false, reason: 'not-configured' });

  try {
    if (await isLoginEmailRateLimited(supabase, phone)) {
      return res.status(200).json({ ok: true, sent: false, reason: 'rate-limited' });
    }
  } catch (e) {
    // Rate-limit store unreachable - the database is down, so nothing below
    // could work either. Not a login problem for the caller.
    return res.status(200).json({ ok: true, sent: false, reason: 'unavailable' });
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
        // Looked up by the canonical 10-digit key (lib/storage-policy.js).
        // The old `[phone]` lookup read a map whose keys were "+91..." with
        // a bare 10-digit number, so it never found anyone and every login
        // email was skipped as "no-email".
        try { user = canonicalUsers(JSON.parse(data.value))[userKey(phone)] || null; } catch (e) { user = null; }
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
