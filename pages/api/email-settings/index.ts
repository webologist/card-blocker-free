import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyCors } = require('../../../lib/cors');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkAdminKey } = require('../../../lib/admin-auth');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSettings, saveSettings, WRITABLE_EMAIL_FIELDS } = require('../../../lib/email-settings-store');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { maskSettings } = require('../../../lib/email-providers');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSupabaseServerClient } = require('../../../lib/supabase-server');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sanitizeError } = require('../../../lib/input-validator');

// Vercel copy of server.js's /api/email-settings GET+POST - see EMAIL-SETUP.md.
// Mirrors server.js exactly (same lib/email-settings-store.js and
// lib/email-providers.js) so the admin console's Email Integrations tab
// works the same way locally (node server.js) and on the deployed site.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = checkAdminKey(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    console.error('[EMAIL-SETTINGS] No Supabase client configured - cannot serve /api/email-settings.');
    return res.status(503).json({ error: 'Storage is not configured on this deployment.' });
  }

  try {
    if (req.method === 'GET') {
      const row = await getSettings(supabase);
      return res.status(200).json(maskSettings(row));
    }

    if (req.method === 'POST') {
      const body = (req.body || {}) as Record<string, any>;
      const patch: Record<string, any> = {};
      for (const f of WRITABLE_EMAIL_FIELDS as string[]) {
        if (body[f] !== undefined && body[f] !== '') patch[f] = body[f];
      }
      if (body.active_provider === null) patch.active_provider = null;
      const row = await saveSettings(supabase, patch);
      return res.status(200).json(maskSettings(row));
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[EMAIL-SETTINGS] Error:', error);
    return res.status(500).json({ error: sanitizeError(error) });
  }
}
