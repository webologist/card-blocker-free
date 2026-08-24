import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyCors } = require('../../../lib/cors');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyPhoneToken } = require('../../../lib/phone-token');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSettings: getPaymentSettings } = require('../../../lib/payment-settings-store');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createOrder } = require('../../../lib/cashfree-checkout');
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

// Creates a Cashfree order for the signed-in caller's own saved cards. The
// amount is computed server-side from their actual card count (see
// lib/cashfree-checkout.js) - nothing about how much this costs is ever
// accepted from the client.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const phone = await callerPhone(req);
  if (!phone) return res.status(401).json({ error: 'Sign in required to start a payment.' });

  const supabase = getSupabaseServerClient();
  if (!supabase) return res.status(503).json({ error: 'Storage is not configured on this deployment.' });

  try {
    const paymentSettings = await getPaymentSettings(supabase);
    if (!paymentSettings || paymentSettings.mode !== 'cashfree') {
      return res.status(400).json({ error: 'Cashfree is not the active payment mode.' });
    }
    if (!paymentSettings.cashfree_app_id || !paymentSettings.cashfree_secret_key) {
      return res.status(503).json({ error: 'Cashfree credentials have not been saved yet.' });
    }

    const origin = `https://${req.headers.host}`;
    const { orderId, paymentSessionId, amount } = await createOrder(supabase, paymentSettings, {
      phone,
      returnUrl: origin,
    });
    const env = process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox';
    return res.status(200).json({ ok: true, orderId, paymentSessionId, amount, env });
  } catch (error) {
    console.error('[CASHFREE/CREATE-ORDER] Error:', error);
    return res.status(500).json({ error: sanitizeError(error) });
  }
}
