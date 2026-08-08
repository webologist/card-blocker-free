// api/storage.js
// Server-side storage for user records, replacing the browser-only localStorage
// fallback that app.js drops to when no bridge is present.
//
// This is deliberately NOT a port of the dev bridge in server.js. That one
// accepts any key with no authentication at all, which is tolerable bound to
// localhost but would, on a public deployment, hand every visitor:
//   - `cbp:users`, one blob holding every user's name, phone, alternate
//     number, email and saved cards, and
//   - `otp:<phone>` rows, i.e. live OTP codes.
// So this endpoint inverts the defaults: only known keys are addressable, and
// anything user-owned needs proof of phone ownership and is filtered to what
// that caller is entitled to.
//
// Records are stored one row per user (`user:+91...`) rather than as a single
// shared blob, so a mistake in the filtering cannot leak the whole table in
// one read. The legacy blob is still read as a fallback so existing data keeps
// working; the next write moves that user into their own row.
//
// The access rules live in lib/storage-policy.js so they can be tested without
// HTTP or a database.

const { createClient } = require('@supabase/supabase-js');
const { verifyPhoneToken } = require('../lib/phone-token');
const { checkAdminKey } = require('../lib/admin-auth');
const {
  PUBLIC_KEYS, LEGACY_USERS_KEY, isAddressable, normalize,
  usersMapFor, writableRecords, ownEntries, emptyFor,
} = require('../lib/storage-policy');

const ALLOWED_ORIGINS = ['https://card-blocker.vercel.app', 'https://card-blocker-free.vercel.app', 'http://localhost:3000', 'http://localhost:3001'];

const userRow = (phone) => `user:${phone}`;
const logRow = (phone) => `log:${phone}`;
const feedbackRow = (phone) => `feedback:${phone}`;

function supabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

async function readRow(sb, key) {
  const { data } = await sb.from('kv_store').select('value').eq('key', key).single();
  if (!data) return null;
  try { return JSON.parse(data.value); } catch { return null; }
}

async function writeRow(sb, key, value) {
  return sb.from('kv_store').upsert({ key, value: JSON.stringify(value) }, { onConflict: 'key' });
}

// Every user record currently stored, from the per-user rows plus any account
// still only present in the legacy blob. Read with the service role and never
// returned as-is - callers pass this to the policy helpers, which narrow it.
async function allUserRecords(sb) {
  const seen = new Set();
  const records = [];
  const { data } = await sb.from('kv_store').select('key,value').like('key', 'user:%');
  for (const row of data || []) {
    let rec;
    try { rec = JSON.parse(row.value); } catch { continue; }
    const phone = normalize(rec && rec.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    records.push(rec);
  }
  const legacy = await readRow(sb, LEGACY_USERS_KEY);
  if (legacy && typeof legacy === 'object') {
    for (const rec of Object.values(legacy)) {
      const phone = normalize(rec && rec.phone);
      if (!phone || seen.has(phone)) continue; // a migrated row wins over the blob
      seen.add(phone);
      records.push(rec);
    }
  }
  return records;
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'Origin not allowed' });
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-phone-token, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = req.method === 'GET' ? req.query.key : (req.body || {}).key;
  if (!key) return res.status(400).json({ error: 'key required' });

  // No key enumeration and no arbitrary key access: an unknown key is simply
  // not addressable here, so otp:<phone> rows and the email-provider settings
  // can never be reached from a browser.
  if (!isAddressable(key)) return res.status(404).json({ error: 'Unknown key' });

  const sb = supabaseClient();
  const caller = await verifyPhoneToken(req.headers['x-phone-token']);

  if (req.method === 'GET') {
    if (PUBLIC_KEYS.has(key)) {
      const value = await readRow(sb, key);
      return res.status(200).json(value === null ? null : { key, value: JSON.stringify(value) });
    }
    if (!caller) return res.status(200).json({ key, value: JSON.stringify(emptyFor(key)) });
    if (key === 'cbp:users') {
      const map = usersMapFor(caller, await allUserRecords(sb));
      return res.status(200).json({ key, value: JSON.stringify(map) });
    }
    const row = key === 'cbp:logs' ? logRow(caller) : feedbackRow(caller);
    return res.status(200).json({ key, value: JSON.stringify((await readRow(sb, row)) || []) });
  }

  if (req.method === 'POST') {
    let parsed;
    try {
      const { value } = req.body || {};
      parsed = typeof value === 'string' ? JSON.parse(value) : value;
    } catch { return res.status(400).json({ error: 'value must be JSON' }); }

    if (PUBLIC_KEYS.has(key)) {
      const admin = checkAdminKey(req);
      if (!admin.ok) return res.status(403).json({ error: admin.error });
      await writeRow(sb, key, parsed);
      return res.status(200).json({ key, ok: true });
    }

    if (!caller) return res.status(401).json({ error: 'Phone verification required.' });

    if (key === 'cbp:users') {
      if (!parsed || typeof parsed !== 'object') return res.status(400).json({ error: 'users must be an object' });
      const writable = writableRecords(caller, parsed, await allUserRecords(sb));
      for (const { phone, record } of writable) await writeRow(sb, userRow(phone), record);
      return res.status(200).json({ key, ok: true, written: writable.length });
    }

    const row = key === 'cbp:logs' ? logRow(caller) : feedbackRow(caller);
    const mine = ownEntries(caller, parsed);
    await writeRow(sb, row, mine);
    return res.status(200).json({ key, ok: true, count: mine.length });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
