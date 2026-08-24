import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyCors } = require('../../../lib/cors');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyPhoneToken } = require('../../../lib/phone-token');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSettings: getPaymentSettings } = require('../../../lib/payment-settings-store');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyAndCredit } = require('../../../lib/cashfree-checkout');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSupabaseServerClient } = require('../../../lib/supabase-server');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sanitizeError } = require('../../../lib/input-validator');

async function callerPhone(req: NextApiRequest): Promise<string | null> {
  const header = req.headers['x-phone-token'];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token) return null;
  try { return await verifyPhoneToken(token); } catch (e) { return null; }
}

// Independently re-checks an order's status with Cashfree before crediting
// anything - the return-URL redirect that lands here is only ever treated as
// "go look at this order_id", never as proof of payment on its own. Safe to
// call more than once for the same order.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const phone = await callerPhone(req);
  if (!phone) return res.status(401).json({ error: 'Sign in required to verify a payment.' });

  const { orderId } = (req.body || {}) as { orderId?: string };
  if (!orderId) return res.status(400).json({ error: 'orderId is required.' });

  const supabase = getSupabaseServerClient();
  if (!supabase) return res.status(503).json({ error: 'Storage is not configured on this deployment.' });

  try {
    const paymentSettings = await getPaymentSettings(supabase);
    if (!paymentSettings || !paymentSettings.cashfree_app_id || !paymentSettings.cashfree_secret_key) {
      return res.status(503).json({ error: 'Cashfree credentials have not been saved yet.' });
    }
    const result = await verifyAndCredit(supabase, paymentSettings, { orderId, phone });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[CASHFREE/VERIFY-ORDER] Error:', error);
    return res.status(500).json({ error: sanitizeError(error) });
  }
}
