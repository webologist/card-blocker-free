import type { NextApiRequest, NextApiResponse } from 'next';

// In-memory storage for demonstration (in production, use a database)
const storage: Record<string, any> = {
  'cbp:banks': JSON.stringify([
    { name: 'HDFC Bank', code: 'hdfc' },
    { name: 'ICICI Bank', code: 'icici' },
    { name: 'SBI', code: 'sbi' },
    { name: 'Axis Bank', code: 'axis' },
  ]),
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const phoneToken = req.headers['x-phone-token'] as string;
  const adminKey = req.headers['x-admin-key'] as string;

  try {
    if (req.method === 'GET') {
      const { key } = req.query as { key: string };

      if (!key) {
        return res.status(400).json({ error: 'Missing key parameter' });
      }

      // Public keys that don't require authentication
      const publicKeys = ['cbp:banks'];
      const isPublic = publicKeys.some(pk => key.startsWith(pk));

      // Check authentication for user/admin keys
      if (!isPublic && !phoneToken && !adminKey) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const value = storage[key];

      if (value === undefined) {
        return res.status(404).json({ error: 'Key not found' });
      }

      return res.status(200).json({
        key,
        value: value,
      });
    } else if (req.method === 'POST') {
      const { key, value } = req.body as { key: string; value: any };

      if (!key) {
        return res.status(400).json({ error: 'Missing key' });
      }

      // Require authentication for write operations
      if (!phoneToken && !adminKey) {
        return res.status(401).json({ error: 'Authentication required for write' });
      }

      storage[key] = value;

      return res.status(200).json({
        key,
        value,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Storage API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
