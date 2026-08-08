// api/login-email.js
// Called by a small client-side poller (login-email-notifier.js) whenever a
// fresh account-access entry shows up in the shared activity log - either a
// "Login" (returning user) or a "Registered" (first-time signup). Looks up
// that user's saved email and notifies them via whichever provider the admin
// has connected. Best-effort and silent on failure - this must never block or
// affect the user's actual login flow.
const { createClient } = require('@supabase/supabase-js');
const { getSettings, claimLoginEmail } = require('../lib/email-settings-store');
const { sendEmail } = require('../lib/email-providers');
const { verifyPhoneToken } = require('../lib/phone-token');

const ALLOWED_ORIGINS = ['https://card-blocker.vercel.app', 'https://card-blocker-free.vercel.app', 'http://localhost:3000', 'http://localhost:3001'];

// Headroom matters here: a signup legitimately calls this several times while
// waiting for the user to reach the email screen. Too tight a limit and the
// retries throttle themselves before the address ever arrives. Abuse is really
// bounded by the (phone, ts) claim - one email per login no matter what - so
// this only needs to stop someone hammering with many distinct timestamps.
const rateLimitMap = new Map();
function isRateLimited(phone) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const hits = (rateLimitMap.get(phone) || []).filter((t) => now - t < windowMs);
  if (hits.length >= 15) return true;
  hits.push(now);
  rateLimitMap.set(phone, hits);
  return false;
}

function supabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(url, key);
}

// Two places a user's email can live:
//  - user_directory: written at OTP verification. The only source that works on
//    production, where app data stays in the visitor's browser.
//  - kv_store cbp:users: the app's own record. Real only in local dev, where
//    server.js bridges window.storage to Supabase.
// Directory wins; kv_store is the fallback so local dev keeps working.
async function lookupUser(supabase, phone) {
  const { data: dir } = await supabase
    .from('user_directory').select('email, name').eq('phone', phone).maybeSingle();
  if (dir && dir.email) return dir;

  const { data } = await supabase.from('kv_store').select('value').eq('key', 'cbp:users').single();
  if (!data) return null;
  try { return JSON.parse(data.value)[phone] || null; } catch { return null; }
}

// Wording differs by event: a signup is expected and reassuring, a login on an
// existing account is the one worth flagging as "wasn't you?".
function buildMessage(event, user, phone, ts) {
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

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'Origin not allowed' });
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, ts, event, phoneToken } = req.body || {};
  // Always answer {ok:true} on well-formed-but-uninteresting input so this
  // endpoint can't be used to probe which phone numbers exist.
  if (!phone || !ts) return res.status(200).json({ ok: true, sent: false, reason: 'bad-request' });

  // Proof that the caller just passed OTP for this number. Without it, the
  // body alone decided whose inbox got a "Security alert: new sign-in" mail:
  // anyone who knew a registered number could send a stream of them by varying
  // `ts`, and could tell registered numbers from unregistered ones by whether
  // the reply said "sent" or "no-email". The claim now has to be signed.
  const verified = await verifyPhoneToken(phoneToken);
  if (!verified || verified.replace(/\D/g, '').replace(/^91/, '') !== String(phone).replace(/\D/g, '').replace(/^91/, '')) {
    return res.status(200).json({ ok: true, sent: false, reason: 'unverified' });
  }
  // Labelled so the caller can tell "try again shortly" apart from "give up".
  if (isRateLimited(phone)) return res.status(200).json({ ok: true, sent: false, reason: 'rate-limited' });

  const supabase = supabaseClient();
  try {
    // Order matters. Signup logs "Registered" as soon as OTP passes, but the
    // email address is only collected a couple of screens later - so the first
    // call for a new user legitimately has nothing to send to. Claiming the
    // row before that check recorded "done" for an email that never went out,
    // and the claim then blocked every retry. Look first, claim only once
    // there is something to send.
    const cfg = await getSettings(supabase);
    if (!cfg || !cfg.active_provider) return res.status(200).json({ ok: true, sent: false, reason: 'no-provider' });

    const user = await lookupUser(supabase, phone);
    if (!user || !user.email) return res.status(200).json({ ok: true, sent: false, reason: 'no-email' });

    // Claimed last, so concurrent tabs still produce exactly one email.
    const claimed = await claimLoginEmail(supabase, phone, String(ts));
    if (!claimed) return res.status(200).json({ ok: true, sent: false, reason: 'duplicate' });

    await sendEmail(cfg, null, Object.assign({ to: user.email }, buildMessage(event, user, phone, ts)));
    return res.status(200).json({ ok: true, sent: true });
  } catch (e) {
    console.error('[login-email] error:', e.message);
    return res.status(200).json({ ok: true }); // never surface send failures to the client
  }
}
