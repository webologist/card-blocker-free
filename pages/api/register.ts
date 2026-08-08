import type { NextApiRequest, NextApiResponse } from 'next';

const registrations: Record<string, any> = {};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Set CORS headers FIRST, before any response
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only POST and GET allowed
  if (!['GET', 'POST'].includes(req.method || '')) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (req.method === 'GET') {
      // Return list of registrations (for testing)
      return res.status(200).json({
        count: Object.keys(registrations).length,
        registrations: Object.keys(registrations)
      });
    }

    if (req.method === 'POST') {
      const { phone, email, alternatePhone } = req.body;

      // Validate phone
      if (!phone || typeof phone !== 'string') {
        return res.status(400).json({ error: 'Phone is required' });
      }

      if (!/^\d{10}$/.test(phone)) {
        return res.status(400).json({ error: 'Phone must be 10 digits' });
      }

      // Store registration
      registrations[phone] = {
        phone,
        email: email || null,
        alternatePhone: alternatePhone || null,
        registeredAt: new Date().toISOString(),
      };

      console.log(`Registration successful for ${phone}`);

      return res.status(200).json({
        success: true,
        message: 'Registration successful! OTP sent to your phone.',
        phone,
        email: email || null,
      });
    }
  } catch (error) {
    console.error('Registration handler error:', error);
    return res.status(500).json({
      error: 'Server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
