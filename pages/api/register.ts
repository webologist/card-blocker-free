import type { NextApiRequest, NextApiResponse } from 'next';

// Simple registration endpoint
const registrations: Record<string, any> = {};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS headers first
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  try {
    const { phone, email, alternatePhone } = req.body;

    if (!phone || !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    // Store registration
    registrations[phone] = {
      phone,
      email: email || null,
      alternatePhone: alternatePhone || null,
      registeredAt: new Date().toISOString(),
    };

    return res.status(200).json({
      success: true,
      message: 'Registration successful',
      phone,
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}
