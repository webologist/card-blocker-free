import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyCors } = require('../../lib/cors');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readOtpToken, otpMatches } = require('../../lib/otp-token');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { issuePhoneToken } = require('../../lib/phone-token');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSupabaseServerClient } = require('../../lib/supabase-server');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkAndRecord } = require('../../lib/rate-limit-store');

// Bounds how many guesses a single challenge token can absorb, independent of
// the 3-per-10-minutes limit on requesting a new one in send-otp.ts. Backed
// by the persistent store (falls back to an in-memory Map only when
// Supabase isn't configured) so a restart mid-window doesn't hand an
// attacker a fresh set of guesses against a still-valid token.
const attemptsByTokenFallback = new Map<string, number>();
async function tooManyAttempts(token: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (supabase) {
    // Same 10-minute window as the OTP's own expiry (send-otp.ts) - once the
    // token expires, the attempt count expiring alongside it is fine.
    const result = await checkAndRecord(supabase, 'verify-attempts', token, 10 * 60 * 1000, 5);
    return result.limited;
  }
  const n = (attemptsByTokenFallback.get(token) || 0) + 1;
  attemptsByTokenFallback.set(token, n);
  return n > 5;
}

function normalizePhone(raw: string) {
  const digits = String(raw || '').replace(/\D/g, '').replace(/^91/, '');
  return { digits, full: digits ? '+91' + digits : '' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, otp, token } = req.body as {
      phone?: string;
      otp?: string;
      token?: string;
    };

    if (!phone) return res.status(400).json({ error: 'Phone number is required' });
    if (!otp) return res.status(400).json({ error: 'OTP is required' });
    if (!token) return res.status(400).json({ error: 'Token is required' });

    const { digits, full } = normalizePhone(phone);
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    if (!/^\d{4,6}$/.test(otp)) {
      return res.status(400).json({ error: 'Invalid OTP format' });
    }

    if (await tooManyAttempts(token)) {
      return res.status(429).json({ success: false, error: 'Too many attempts. Please request a new OTP.' });
    }

    // The token is the only source of truth for what code was actually
    // issued and to whom - nothing here trusts a client-supplied verdict.
    // This replaces a previous "dummyMode" branch that accepted ANY 4-6
    // digit value as correct for ANY phone number with no check at all
    // (audit finding C2).
    let record: { phone: string; otpHash: string; expiresAt: number; dummy: boolean } | null = null;
    try {
      record = await readOtpToken(token);
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid or expired token' });
    }

    if (!record || record.phone !== full) {
      return res.status(400).json({ success: false, error: 'Invalid token' });
    }
    if (Date.now() > record.expiresAt) {
      return res.status(400).json({ success: false, error: 'OTP expired. Please request a new one.' });
    }

    const ok = await otpMatches(record, otp);
    if (!ok) {
      return res.status(401).json({ success: false, error: 'Invalid OTP' });
    }

    const phoneToken = await issuePhoneToken(full);

    // This route has no database of its own (see pages/api/storage.ts,
    // currently a non-persisting stub) - saved cards are loaded separately
    // via /api/storage once that endpoint's access control is wired up for
    // whichever deployment actually serves this route. Returning hardcoded
    // demo card data for a magic phone number here - as this endpoint used
    // to - has no place in an authentication response.
    return res.status(200).json({
      success: true,
      phoneToken,
      savedCards: [],
      userName: null,
    });
  } catch (error) {
    console.error('[VERIFY] Error:', error);
    return res.status(500).json({ success: false, error: 'Verification failed' });
  }
}
