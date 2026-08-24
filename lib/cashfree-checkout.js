// lib/cashfree-checkout.js
// Server-side Cashfree Payment Gateway integration: create an order, then
// independently verify its status with Cashfree before ever crediting an
// account - never trust a client-supplied "it worked".
//
// Amount is always computed here from the caller's own saved card count
// (RATE_PER_CARD each), never accepted from the client - the client only ever
// supplies which order it's asking about, not how much it's worth.
//
// The order->phone mapping lives in kv_store under a `cfpay:` prefix, the
// same pattern lib/rate-limit-store.js uses for `ratelimit:` - deliberately
// outside PUBLIC_KEYS/OWNED_KEYS/ADMIN_KEYS in lib/storage-policy.js, so it's
// never reachable through the public /api/storage passthrough.

const { normalize, dedupeEntries } = require('./storage-policy');

const RATE_PER_CARD = 50; // mirrors app.js's `rt` constant - keep in sync if that ever changes

// CASHFREE_ENV picks which of Cashfree's two environments the sandbox/live
// App ID + Secret Key saved in the admin panel are checked against. Sandbox
// credentials only work against the sandbox host and vice versa - Cashfree
// itself will 401 with a clear error if these are mismatched. Defaults to
// sandbox since that's what a fresh signup gets first; set to "production"
// once live keys replace the sandbox ones in the admin panel.
function apiBase() {
  return process.env.CASHFREE_ENV === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

function authHeaders(settings) {
  return {
    'x-client-id': settings.cashfree_app_id,
    'x-client-secret': settings.cashfree_secret_key,
    'x-api-version': '2023-08-01',
    'Content-Type': 'application/json',
  };
}

async function readRow(supabase, key) {
  const { data, error } = await supabase.from('kv_store').select('value').eq('key', key).single();
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return data ? data.value : null;
}

async function writeRow(supabase, key, value) {
  const { error } = await supabase.from('kv_store').upsert({ key, value }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

function parseOr(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch (e) { return fallback; }
}

async function ownCardCount(supabase, phone) {
  const me = normalize(phone);
  const raw = await readRow(supabase, 'cbp:users');
  const all = parseOr(raw, {});
  for (const rec of Object.values(all)) {
    if (rec && normalize(rec.phone) === me) return Array.isArray(rec.cards) ? rec.cards.length : 0;
  }
  return 0;
}

// Creates a Cashfree order for the caller's own saved cards. Throws with a
// human-readable message on any failure - callers should catch and 500/503.
async function createOrder(supabase, settings, { phone, returnUrl }) {
  if (!settings || !settings.cashfree_app_id || !settings.cashfree_secret_key) {
    throw new Error('Cashfree is not configured.');
  }
  const cardCount = await ownCardCount(supabase, phone);
  if (cardCount < 1) throw new Error('No saved cards to charge for.');
  const amount = cardCount * RATE_PER_CARD;

  const orderId = `cf_${normalize(phone).replace('+', '')}_${Date.now()}`;
  const res = await fetch(`${apiBase()}/orders`, {
    method: 'POST',
    headers: authHeaders(settings),
    body: JSON.stringify({
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: normalize(phone).replace('+', ''),
        customer_phone: normalize(phone).replace('+91', ''),
      },
      // #card-tool scrolls back to the widget on return - purely a client-
      // side anchor, Cashfree only ever sees/uses the query string part.
      order_meta: { return_url: `${returnUrl}?cf_order_id={order_id}#card-tool` },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body && (body.message || body.error)) || `Cashfree error (${res.status})`);
  }

  // Record who this order belongs to and for how much, so verifyAndCredit()
  // never has to trust a client-supplied phone/amount - only which order_id
  // to look up.
  await writeRow(supabase, `cfpay:${orderId}`, JSON.stringify({
    phone: normalize(phone), amount, createdAt: new Date().toISOString(), credited: false,
  }));

  return { orderId, paymentSessionId: body.payment_session_id, amount };
}

// Wording matches app.js's own "Payment successful (simulated)" log entries
// for the free/dummy paths, so the admin activity log reads consistently.
function buildLogEntry(phone, amount) {
  return {
    t: new Date().toLocaleString('en-IN', { hour12: true }),
    actor: phone,
    action: 'Payment successful (Cashfree)',
    detail: `₹${amount} - order verified server-side`,
  };
}

// Re-checks the order's status directly with Cashfree (never trusts the
// return-URL redirect alone - that's just where to look, not proof of
// anything) and only then credits the account. Safe to call more than once
// for the same order (e.g. a page refresh on the return page): crediting an
// already-credited order is a no-op merge, not a double charge.
async function verifyAndCredit(supabase, settings, { orderId, phone }) {
  if (!settings || !settings.cashfree_app_id || !settings.cashfree_secret_key) {
    throw new Error('Cashfree is not configured.');
  }
  const mappingRaw = await readRow(supabase, `cfpay:${orderId}`);
  const mapping = parseOr(mappingRaw, null);
  if (!mapping || mapping.phone !== normalize(phone)) {
    throw new Error('This order does not belong to your account.');
  }

  const res = await fetch(`${apiBase()}/orders/${encodeURIComponent(orderId)}`, {
    headers: authHeaders(settings),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body && (body.message || body.error)) || `Cashfree error (${res.status})`);

  if (body.order_status !== 'PAID') {
    return { credited: false, status: body.order_status || 'UNKNOWN' };
  }

  // Merge-credit cbp:users - same shape as app.js's own Qe()/jt() write, just
  // performed server-side once payment is independently confirmed.
  const usersRaw = await readRow(supabase, 'cbp:users');
  const allUsers = parseOr(usersRaw, {});
  const me = normalize(phone);
  let ownKey = null;
  for (const [k, rec] of Object.entries(allUsers)) {
    if (rec && normalize(rec.phone) === me) { ownKey = k; break; }
  }
  if (ownKey) {
    allUsers[ownKey] = { ...allUsers[ownKey], saved: true, paid: true, paidAmount: mapping.amount };
    await writeRow(supabase, 'cbp:users', JSON.stringify(allUsers));
  }

  const logsRaw = await readRow(supabase, 'cbp:logs');
  const existingLogs = parseOr(logsRaw, []);
  const merged = dedupeEntries([
    ...(Array.isArray(existingLogs) ? existingLogs : []),
    buildLogEntry(phone, mapping.amount),
  ]);
  await writeRow(supabase, 'cbp:logs', JSON.stringify(merged));

  if (!mapping.credited) {
    await writeRow(supabase, `cfpay:${orderId}`, JSON.stringify({ ...mapping, credited: true }));
  }

  return { credited: true, amount: mapping.amount };
}

module.exports = { RATE_PER_CARD, createOrder, verifyAndCredit };
