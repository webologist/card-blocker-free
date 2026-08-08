import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-phone-token, x-admin-key');
  res.setHeader('Access-Control-Max-Age', '3600');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, email } = req.body as { phone: string; email?: string };

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Validate 10-digit phone number
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // In production, send real OTP via Twilio
    // For now, return dummy OTP (mode is set via /api/storage)
    const otp = '1234'; // Dummy OTP

    return res.status(200).json({
      success: true,
      message: `OTP sent to ${phone}`,
      phone,
      email: email || null,
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
}
