import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyCors } = require('../../../lib/cors');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkAdminAccess } = require('../../../lib/admin-auth');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  getSettings, saveSettings, maskSettings, GATEWAY_FIELDS, MODES,
} = require('../../../lib/payment-settings-store');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { saveSettings: saveRazorpaySettings } = require('../../../lib/razorpay-settings-store');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSupabaseServerClient } = require('../../../lib/supabase-server');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sanitizeError } = require('../../../lib/input-validator');

// Vercel copy of server.js's /api/payment/settings GET+POST - see
// admin-razorpay-toggle.js (the admin console's "Payment Gateway" tab) and
// app.js's GET /api/payment/mode read. Mirrors server.js exactly so the panel
// works the same locally (node server.js) and on the deployed site.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await checkAdminAccess(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    console.error('[PAYMENT-SETTINGS] No Supabase client configured.');
    return res.status(503).json({ error: 'Storage is not configured on this deployment.' });
  }

  try {
    if (req.method === 'GET') {
      const settings = await getSettings(supabase);
      return res.status(200).json({ ok: true, data: maskSettings(settings) });
    }

    if (req.method === 'POST') {
      const body = (req.body || {}) as Record<string, any>;
      const { mode } = body;
      if (mode !== undefined && !(MODES as string[]).includes(mode)) {
        return res.status(400).json({ error: 'Invalid mode. Must be one of: ' + (MODES as string[]).join(', ') });
      }

      const patch: Record<string, any> = {};
      if (mode !== undefined) patch.mode = mode;
      for (const fields of Object.values(GATEWAY_FIELDS as Record<string, any>)) {
        const idVal = body[(fields as any).id];
        const secretVal = body[(fields as any).secret];
        if (typeof idVal === 'string' && idVal.trim()) patch[(fields as any).id] = idVal.trim();
        if (typeof secretVal === 'string' && secretVal.trim()) patch[(fields as any).secret] = secretVal.trim();
      }

      const settings = await saveSettings(supabase, patch);

      // Keep the (unused-by-the-frontend-today) Razorpay checkout backend's
      // own table in sync, same as server.js.
      if (patch.mode !== undefined || patch.razorpay_key_id || patch.razorpay_key_secret) {
        const rpPatch: Record<string, any> = {};
        if (patch.mode !== undefined) rpPatch.enabled = patch.mode === 'razorpay';
        if (patch.razorpay_key_id) rpPatch.razorpay_key_id = patch.razorpay_key_id;
        if (patch.razorpay_key_secret) rpPatch.razorpay_key_secret = patch.razorpay_key_secret;
        if (Object.keys(rpPatch).length) {
          await saveRazorpaySettings(supabase, rpPatch).catch((e: Error) =>
            console.error('[PAYMENT-SETTINGS] razorpay sync failed:', e.message));
        }
      }

      return res.status(200).json({ ok: true, data: maskSettings(settings) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[PAYMENT-SETTINGS] Error:', error);
    return res.status(500).json({ error: sanitizeError(error) });
  }
}
