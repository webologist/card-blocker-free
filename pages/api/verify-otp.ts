import type { NextApiRequest, NextApiResponse } from 'next';

// For demo: store valid tokens (in production use signed tokens/JWT)
const validTokens = new Set<string>();

// Mock function to validate token
function isValidToken(token: string): boolean {
  return token.startsWith('dummy-') || validTokens.has(token);
}

// Mock function to generate phone token
function generatePhoneToken(): string {
  return 'phone-token-' + Date.now() + '-' + Math.random().toString(36).substring(7);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-phone-token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, otp, token, dummyMode } = req.body as {
      phone?: string;
      otp?: string;
      token?: string;
      dummyMode?: boolean;
    };

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    if (!otp) {
      return res.status(400).json({ error: 'OTP is required' });
    }

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // Validate phone format
    const digits = phone.replace(/\D/g, '').replace(/^91/, '');
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    // In dummy mode, accept any OTP
    if (dummyMode) {
      if (!/^\d{4,6}$/.test(otp)) {
        return res.status(400).json({ error: 'Invalid OTP format' });
      }

      const phoneToken = generatePhoneToken();
      console.log(`[VERIFY] DUMMY MODE phone=${phone}, verified=true, phoneToken=${phoneToken}`);

      // Mock saved cards for phone 9999999999
      let savedCards = [];
      if (phone === '+919999999999' || digits === '9999999999') {
        savedCards = [
          {
            type: 'Debit',
            bank: 'Bank',
            last4: '1234'
          },
          {
            type: 'Credit',
            bank: 'Bank',
            last4: '3333'
          }
        ];
      }

      return res.status(200).json({
        success: true,
        phoneToken,
        savedCards,
        userName: 'Nine Nine'
      });
    }

    // Production mode would validate via signed tokens
    if (!isValidToken(token)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (otp !== '1234') {
      return res.status(401).json({ error: 'Invalid OTP' });
    }

    const phoneToken = generatePhoneToken();
    return res.status(200).json({
      success: true,
      phoneToken,
      savedCards: [],
      userName: 'User'
    });

  } catch (error) {
    console.error('[VERIFY] Error:', error);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
