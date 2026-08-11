import type { NextApiRequest, NextApiResponse } from 'next';

const rateLimitMap = new Map<string, number[]>();

function isRateLimited(phone: string): boolean {
  const now = Date.now();
  const window = 10 * 60 * 1000;
  const max = 3;
  const hits = (rateLimitMap.get(phone) || []).filter(t => now - t < window);
  if (hits.length >= max) return true;
  hits.push(now);
  rateLimitMap.set(phone, hits);
  return false;
}

// Dummy token generation
function generateToken(): string {
  return 'dummy-' + Date.now();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('[SEND-OTP-REBUILD] Endpoint called at', new Date().toISOString());
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, dummyMode } = req.body as { phone?: string; dummyMode?: boolean };

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Validate phone format
    const digits = phone.replace(/\D/g, '').replace(/^91/, '');
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return res.status(400).json({
        error: 'Invalid phone number. Enter a 10-digit Indian mobile number starting with 6-9.'
      });
    }

    if (isRateLimited(digits)) {
      return res.status(429).json({ error: 'Too many OTP requests. Please wait 10 minutes.' });
    }

    // In dummy mode, return a token immediately
    if (dummyMode) {
      const token = generateToken();
      console.log(`[OTP] DUMMY MODE phone=${phone}, token=${token}`);
      return res.status(200).json({
        success: true,
        token,
        message: 'Dummy mode: OTP is 1234'
      });
    }

    // Production mode would send real OTP via Twilio
    const token = generateToken();
    return res.status(200).json({
      success: true,
      token,
      message: `OTP sent to ${phone}`
    });

  } catch (error) {
    console.error('[OTP] Error:', error);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
}
