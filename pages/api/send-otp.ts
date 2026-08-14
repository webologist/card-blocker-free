import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyCors } = require('../../lib/cors');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveDummyMode } = require('../../lib/otp-mode');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { issueOtpToken } = require('../../lib/otp-token');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSupabaseServerClient } = require('../../lib/supabase-server');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkAndRecord } = require('../../lib/rate-limit-store');

// In-memory fallback only used when Supabase isn't configured at all (local
// dev without env vars) - see lib/rate-limit-store.js for why a Map alone
// isn't good enough for a deployed instance (resets every cold start).
const rateLimitMapFallback = new Map<string, number[]>();

async function isRateLimited(phone: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (supabase) {
    const result = await checkAndRecord(supabase, 'send-otp', phone, 10 * 60 * 1000, 3);
    return result.limited;
  }
  const now = Date.now();
  const window = 10 * 60 * 1000;
  const max = 3;
  const hits = (rateLimitMapFallback.get(phone) || []).filter(t => now - t < window);
  if (hits.length >= max) return true;
  hits.push(now);
  rateLimitMapFallback.set(phone, hits);
  return false;
}

// Reads the admin console's dummy/live toggle (cbp:otp_mode). Falls back to
// "unset" (i.e. env/production settings alone decide) if Supabase isn't
// configured or the row doesn't exist - see resolveDummyMode in
// lib/otp-mode.js for why that toggle can only make this MORE restrictive,
// never less.
async function readOtpModeToggle(): Promise<string | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;
  try {
    const { data } = await supabase.from('kv_store').select('value').eq('key', 'cbp:otp_mode').single();
    if (!data || !data.value) return null;
    try {
      return JSON.parse(data.value);
    } catch (e) {
      return data.value;
    }
  } catch (e) {
    return null;
  }
}

function normalizePhone(raw: string) {
  const digits = String(raw || '').replace(/\D/g, '').replace(/^91/, '');
  return { digits, full: digits ? '+91' + digits : '' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('[SEND-OTP] Endpoint called at', new Date().toISOString());
  applyCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone } = req.body as { phone?: string };

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const { digits, full } = normalizePhone(phone);
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return res.status(400).json({
        error: 'Invalid phone number. Enter a 10-digit Indian mobile number starting with 6-9.'
      });
    }

    if (await isRateLimited(digits)) {
      return res.status(429).json({ error: 'Too many OTP requests. Please wait 10 minutes.' });
    }

    // The server alone decides whether this is dummy mode (lib/otp-mode.js).
    // A client-supplied "dummyMode" flag used to be trusted here, which let
    // any caller skip real verification for any phone number - see the
    // pre-launch audit's finding C2. The admin console's toggle is folded in
    // via resolveDummyMode so it can force live mode for a real test even
    // while OTP_MODE=dummy, but can never force dummy mode open beyond that.
    const otpToggle = await readOtpModeToggle();
    const dummy = resolveDummyMode(full, otpToggle);
    const expiresAt = Date.now() + 10 * 60 * 1000;
    let otp: string;

    if (dummy) {
      otp = '1234';
      console.log(`[OTP] DUMMY MODE phone=${full}`);
    } else {
      if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
        console.error('[OTP] Live mode requested but Twilio is not configured (TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER).');
        return res.status(503).json({ error: 'OTP delivery is not available right now. Please try again later.' });
      }
      otp = String(Math.floor(1000 + Math.random() * 9000));
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await twilioClient.messages.create({
          body: `Your BlockMyCard OTP is: ${otp}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: full,
        });
      } catch (e) {
        console.error('[OTP] Twilio send error:', (e as Error).message);
        return res.status(502).json({ error: 'Could not send OTP. Please try again.' });
      }
    }

    // The challenge is carried in a signed, HMAC-protected token rather than
    // any server-side session store (this route has none) - see
    // lib/otp-token.js. The client never sees the OTP value itself unless
    // dummy mode is genuinely on.
    const token = await issueOtpToken({ phone: full, otp, expiresAt, dummy });

    return res.status(200).json({
      success: true,
      token,
      message: dummy ? 'Dummy mode: OTP is 1234' : `OTP sent to ${full}`,
    });
  } catch (error) {
    console.error('[OTP] Error:', error);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
}
