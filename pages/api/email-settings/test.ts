import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyCors } = require('../../../lib/cors');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkAdminKey } = require('../../../lib/admin-auth');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSettings } = require('../../../lib/email-settings-store');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendEmail } = require('../../../lib/email-providers');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSupabaseServerClient } = require('../../../lib/supabase-server');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sanitizeError } = require('../../../lib/input-validator');

// Vercel copy of server.js's /api/email-settings/test - see EMAIL-SETUP.md.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = checkAdminKey(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    console.error('[EMAIL-SETTINGS/TEST] No Supabase client configured.');
    return res.status(503).json({ error: 'Storage is not configured on this deployment.' });
  }

  const { to, provider } = (req.body || {}) as { to?: string; provider?: string };
  if (!to) return res.status(400).json({ error: 'A recipient email ("to") is required.' });

  try {
    const cfg = await getSettings(supabase);
    if (!cfg) return res.status(400).json({ error: 'No email provider has been configured yet.' });
    const result = await sendEmail(cfg, provider || null, {
      to,
      subject: 'BlockMyCard test email',
      html: '<p>This is a test email from your BlockMyCard admin console. If you got this, the connection works.</p>',
      text: 'This is a test email from your BlockMyCard admin console. If you got this, the connection works.',
    });
    return res.status(200).json({ success: true, provider: result.provider, messageId: result.messageId || null });
  } catch (error: any) {
    console.error('[EMAIL-SETTINGS/TEST] Error:', error);
    return res.status(500).json({ error: sanitizeError(error) });
  }
}
