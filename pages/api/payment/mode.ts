import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyCors } = require('../../../lib/cors');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSettings, MODES } = require('../../../lib/payment-settings-store');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSupabaseServerClient } = require('../../../lib/supabase-server');

// Vercel copy of server.js's /api/payment/mode - public, no secrets, read by
// app.js on every page load to decide whether to show the "save your cards"
// fee. Fails safe to 'dummy' (the app's existing, already-shipped behaviour)
// so any error here never silently changes what a user sees.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabaseServerClient();
  if (!supabase) return res.status(200).json({ mode: 'dummy' });

  try {
    const settings = await getSettings(supabase);
    const mode = settings && (MODES as string[]).includes(settings.mode) ? settings.mode : 'dummy';
    return res.status(200).json({ mode });
  } catch (error) {
    return res.status(200).json({ mode: 'dummy' });
  }
}
