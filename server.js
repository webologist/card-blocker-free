require('dotenv').config({ path: '.env.db' });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { checkAdminKey, checkAdminAccess, isAdminPhone } = require('./lib/admin-auth');
const { issuePhoneToken, verifyPhoneToken } = require('./lib/phone-token');
const { corsOriginCheck } = require('./lib/cors');
const { validatePhone, validateOTP, validateToken, sanitizeError } = require('./lib/input-validator');
const {
  PUBLIC_KEYS, OWNED_KEYS, ADMIN_KEYS, isAddressable,
  usersMapFor, writableRecords, ownEntries, normalizedEntryOwner, emptyFor, normalize: normalizePhoneKey,
  dedupeEntries,
} = require('./lib/storage-policy');
const { checkAndRecord, expressRateLimiter } = require('./lib/rate-limit-store');
const { resolveDummyMode } = require('./lib/otp-mode');

console.log('🔧 [STARTUP] server.js loaded with phoneToken support');
const { getSettings, saveSettings, claimLoginEmail } = require('./lib/email-settings-store');
const { getSettings: getRazorpaySettings, saveSettings: saveRazorpaySettings, maskSettings: maskRazorpaySettings } = require('./lib/razorpay-settings-store');
const { getSettings: getPaymentSettings, saveSettings: savePaymentSettings, maskSettings: maskPaymentSettings, GATEWAY_FIELDS: PAYMENT_GATEWAY_FIELDS, MODES: PAYMENT_MODES } = require('./lib/payment-settings-store');
const { sendEmail, maskSettings } = require('./lib/email-providers');
const { validateContact, buildContactEmail, contactRecipient, storageKey } = require('./lib/contact');

const app = express();
app.use(cors({ origin: corsOriginCheck, credentials: false }));
app.use(express.json());

// Rate limiting middleware for authentication endpoints. Backed by
// lib/rate-limit-store.js (Supabase kv_store) instead of an in-memory Map, so
// the limit survives a restart instead of resetting on every deploy. Passing
// a getter rather than the `supabase` client itself lets this be defined
// before that client exists below - it's only called once a real request
// comes in.
const otpLimiter = expressRateLimiter(() => supabase, {
  scope: 'otp',
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 500, // TEMP: Increased for testing (roll back to 5 after testing)
  keyGenerator: (req) => (req.body && req.body.phone) || req.ip || 'unknown',
});

// ── Supabase client ──
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

console.log('Supabase URL:', supabaseUrl);
console.log('Key loaded:', !!supabaseKey);

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Storage API (mimics Vercel KV window.storage) ──
//
// This used to proxy straight to kv_store with no auth check at all: any
// request could read or overwrite any key, including the full user/card
// table and in-flight OTP challenges (key "otp:<phone>"). Every key now goes
// through lib/storage-policy.js's registry (PUBLIC_KEYS / OWNED_KEYS /
// ADMIN_KEYS) - an unlisted key is rejected outright, and OWNED_KEYS are
// filtered to what the caller identified by their x-phone-token is actually
// entitled to see or change. See lib/storage-policy.js for the "why".

async function callerPhone(req) {
  const header = req.headers['x-phone-token'];
  if (!header) return null;
  try {
    return await verifyPhoneToken(header);
  } catch (e) {
    return null;
  }
}

async function readRow(key) {
  const { data, error } = await supabase.from('kv_store').select('value').eq('key', key).single();
  if (error && error.code !== 'PGRST116') throw new Error(error.message); // PGRST116 = no row
  return data ? data.value : null;
}

async function writeRow(key, value) {
  const { error } = await supabase.from('kv_store').upsert({ key, value }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

function parseOr(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (e) {
    return fallback;
  }
}

app.get('/api/storage', async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Key is required' });

  try {
    if (ADMIN_KEYS.has(key)) {
      const auth = await checkAdminAccess(req);
      if (!auth.ok) return res.status(401).json({ error: auth.error });
      const value = await readRow(key);
      return res.json({ key, value });
    }

    if (!isAddressable(key)) {
      console.warn('[STORAGE] Rejected read of unknown key:', key);
      return res.status(400).json({ error: 'Unknown storage key' });
    }

    if (PUBLIC_KEYS.has(key)) {
      const value = await readRow(key);
      return res.json({ key, value });
    }

    // OWNED_KEYS from here on - the caller must prove who they are, and only
    // gets back what belongs to them.
    const phone = await callerPhone(req);
    if (!phone) return res.status(401).json({ error: 'Sign in required to read this data.' });

    const raw = await readRow(key);
    if (key === 'cbp:users') {
      const allUsers = parseOr(raw, {});
      // The admin console needs every registered user, not just whatever
      // the admin's own phone number happens to reach - see isAdminPhone's
      // doc comment for why the usual per-caller narrowing doesn't apply.
      const value = isAdminPhone(phone) ? allUsers : usersMapFor(phone, Object.values(allUsers));
      return res.json({ key, value: JSON.stringify(value) });
    }

    // cbp:logs / cbp:feedback - owned lists. Admin needs the full activity
    // log / feedback list to run the admin console (same reasoning as
    // cbp:users just above); everyone else only gets entries that are
    // theirs (see entryOwner()/ownEntries() in storage-policy.js for the
    // NEW-04 fix around log entries using `actor` rather than `phone`).
    const list = parseOr(raw, []);
    const filtered = isAdminPhone(phone) ? (Array.isArray(list) ? list : []) : ownEntries(phone, Array.isArray(list) ? list : []);
    return res.json({ key, value: JSON.stringify(filtered) });
  } catch (e) {
    console.error('[STORAGE] GET error:', e.message);
    res.status(500).json({ error: sanitizeError(e) });
  }
});

app.post('/api/storage', async (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key required' });

  try {
    if (ADMIN_KEYS.has(key)) {
      const auth = await checkAdminAccess(req);
      if (!auth.ok) return res.status(401).json({ error: auth.error });
      await writeRow(key, value);
      return res.json({ key, value });
    }

    if (!isAddressable(key)) {
      console.warn('[STORAGE] Rejected write of unknown key:', key);
      return res.status(400).json({ error: 'Unknown storage key' });
    }

    if (PUBLIC_KEYS.has(key)) {
      // Reference data (banks/templates) - identical for every user, so only
      // an admin may change it.
      const auth = await checkAdminAccess(req);
      if (!auth.ok) return res.status(401).json({ error: auth.error });
      await writeRow(key, value);
      return res.json({ key, value });
    }

    // OWNED_KEYS - the incoming value is a *proposal*. We narrow it to what
    // this caller may write and merge that into the existing row, so a stale
    // or malicious payload can never touch another user's data.
    const phone = await callerPhone(req);
    if (!phone) return res.status(401).json({ error: 'Sign in required to save this data.' });

    const existingRaw = await readRow(key);

    if (key === 'cbp:users') {
      const existing = parseOr(existingRaw, {});
      const proposed = parseOr(value, {});
      // Admin may write any phone's record, unlike the reachability-narrowed
      // path below - but this must still be an ADDITIVE merge, never a
      // wholesale replace. app.js's mount effect seeds a demo-user entry into
      // whatever partial map it currently has loaded (see rs()'s useEffect),
      // completely independent of the admin console's own edits - trusting
      // `proposed` as the full table let that incidental, partial write blow
      // away every other user the admin's client hadn't (yet) loaded.
      let merged;
      if (isAdminPhone(phone)) {
        merged = Object.assign({}, existing, proposed);
      } else {
        const writable = writableRecords(phone, proposed, Object.values(existing));
        merged = Object.assign({}, existing);
        for (const { phone: p, record } of writable) merged[p] = record;
      }
      await writeRow(key, JSON.stringify(merged));
      return res.json({ key, value: JSON.stringify(merged) });
    }

    // cbp:logs / cbp:feedback - append-only owned lists. The caller's own
    // proposed entries replace their own previous entries in the list;
    // everyone else's entries are left untouched.
    //
    // FIX (13 Aug 2026, NEW-04): this "others" filter used `e.phone`, which
    // cbp:logs entries never have (they use `actor` - see entryOwner() in
    // storage-policy.js). That made every existing log entry count as
    // "someone else's" and kept it verbatim in `others`, while `ownEntries`
    // below independently treated the *entire* incoming proposedList
    // (app.js's addLog always re-sends its whole known history, not just
    // the new entry) as "mine" for the same reason - so every write
    // concatenated the full existing list with the full incoming list,
    // duplicating log entries on every single action instead of just
    // appending the new one. Matching on entryOwner() here the same way
    // ownEntries() does fixes both the duplication and the dedup.
    const existingList = parseOr(existingRaw, []);
    const proposedList = parseOr(value, []);
    if (!Array.isArray(proposedList)) return res.status(400).json({ error: 'Invalid value' });
    const me = normalizePhoneKey(phone);
    const others = (Array.isArray(existingList) ? existingList : []).filter(
      (e) => !e || !normalizedEntryOwner(e) || normalizedEntryOwner(e) !== me
    );
    const ownProposed = ownEntries(phone, proposedList);
    // FIX (14 Aug 2026, NEW-06): dedupe the merged list before persisting -
    // see dedupeEntries() in storage-policy.js for why this is needed even
    // after the entryOwner fix above (that fix stops cross-user leakage, not
    // a caller's own client re-submitting the same entry more than once).
    const merged = dedupeEntries(others.concat(ownProposed));
    await writeRow(key, JSON.stringify(merged));
    return res.json({ key, value: JSON.stringify(merged) });
  } catch (e) {
    console.error('[STORAGE] POST error:', e.message);
    res.status(500).json({ error: sanitizeError(e) });
  }
});

app.delete('/api/storage', async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Key is required' });

  try {
    // Deleting an entire row is destructive for everyone who has data under
    // that key (there is no "delete just my entry" case in this app - that's
    // expressed as a POST that omits the caller's record instead), so this is
    // admin-only regardless of which key it is.
    const auth = await checkAdminAccess(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });
    if (!isAddressable(key)) return res.status(400).json({ error: 'Unknown storage key' });

    const { error } = await supabase.from('kv_store').delete().eq('key', key);
    if (error) throw new Error(error.message);
    res.json({ key, deleted: true });
  } catch (e) {
    console.error('[STORAGE] DELETE error:', e.message);
    res.status(500).json({ error: sanitizeError(e) });
  }
});

app.get('/api/storage/list', async (req, res) => {
  // Enumeration was never filtered by caller and would leak key names across
  // users (e.g. which phone numbers have data) - keep it admin-only.
  const auth = await checkAdminAccess(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  const { prefix } = req.query;
  let query = supabase.from('kv_store').select('key');
  if (prefix) query = query.like('key', prefix + '%');
  const { data } = await query;
  res.json({ keys: (data || []).map(r => r.key) });
});

// Health check endpoint for monitoring
app.get('/api/health', async (req, res) => {
  try {
    // Quick database connectivity check
    await supabase.from('kv_store').select('count', { count: 'exact', head: true });
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('[HEALTH] Database check failed:', e.message);
    res.status(503).json({ status: 'error', error: 'Database unavailable', timestamp: new Date().toISOString() });
  }
});

// ── OTP routes ──
app.post('/api/send-otp', otpLimiter, async (req, res) => {
  console.log('🎯 [SEND-OTP ENDPOINT HIT]');
  const { phone } = req.body;

  // Validate phone format
  if (!validatePhone(phone)) {
    console.warn('[OTP] Invalid phone format:', phone);
    return res.status(400).json({ error: 'Invalid phone number format' });
  }

  // Server decision only - a client-supplied dummyMode let any caller skip
  // OTP verification for any phone number. The admin console's dummy/live
  // toggle (cbp:otp_mode) is read here and passed through resolveDummyMode,
  // which can only make this MORE restrictive (force live) than the
  // OTP_MODE/VERCEL_ENV settings already allow, never less - see the "why" in
  // lib/otp-mode.js.
  let otpToggle = null;
  try {
    const { data: toggleRow } = await supabase.from('kv_store').select('value').eq('key', 'cbp:otp_mode').single();
    if (toggleRow && toggleRow.value) {
      try { otpToggle = JSON.parse(toggleRow.value); } catch (e) { otpToggle = toggleRow.value; }
    }
  } catch (e) {
    // No row / table hiccup - treat as unset, which resolveDummyMode already handles.
  }
  const isDummy = resolveDummyMode(phone, otpToggle);
  if (isDummy) {
    const token = 'dummy-' + Date.now();
    await supabase.from('kv_store').upsert(
      { key: 'otp:' + phone, value: JSON.stringify({ token, otp: '1234', expires: Date.now() + 600000 }) },
      { onConflict: 'key' }
    );
    console.log('[OTP] Dummy - phone: ' + phone + ', OTP: 1234');
    return res.json({ token, message: 'Dummy mode: OTP is 1234' });
  }
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const token = 'live-' + Date.now();
    const otp = String(Math.floor(1000 + Math.random() * 9000));
    await twilio.messages.create({
      body: 'Your BlockMyCard OTP is: ' + otp,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone
    });
    await supabase.from('kv_store').upsert(
      { key: 'otp:' + phone, value: JSON.stringify({ token, otp, expires: Date.now() + 600000 }) },
      { onConflict: 'key' }
    );
    res.json({ token });
  } catch (e) {
    console.error('[OTP] Error:', e.message);
    res.status(500).json({ error: sanitizeError(e) });
  }
});

app.post('/api/verify-otp', otpLimiter, async (req, res) => {
  console.log('🎯 [ENDPOINT HIT] /api/verify-otp called');
  const { phone, otp, token } = req.body;

  console.log('[OTP-DEBUG] Request body:', { phone, otp, tokenPresent: !!token });

  // Validate all required parameters
  if (!validatePhone(phone)) {
    console.log('[OTP-DEBUG] Phone validation failed:', phone);
    return res.status(400).json({ success: false, error: 'Invalid phone number format' });
  }
  if (!validateOTP(otp)) {
    console.log('[OTP-DEBUG] OTP validation failed:', otp);
    return res.status(400).json({ success: false, error: 'Invalid OTP format' });
  }
  if (!validateToken(token)) {
    console.log('[OTP-DEBUG] Token validation failed, token:', token);
    return res.status(400).json({ success: false, error: 'Invalid request' });
  }

  try {
    const { data } = await supabase.from('kv_store').select('value').eq('key', 'otp:' + phone).single();
    if (!data) return res.status(400).json({ success: false, error: 'Invalid OTP' });

    const entry = JSON.parse(data.value);
    if (Date.now() > entry.expires) return res.status(400).json({ success: false, error: 'OTP expired' });
    if (otp !== entry.otp || token !== entry.token) return res.status(400).json({ success: false, error: 'Invalid OTP' });

    await supabase.from('kv_store').delete().eq('key', 'otp:' + phone);

    // Issue a phone token for admin panel access
    console.log('[OTP] About to issue phone token for phone:', phone);
    let phoneToken = null;
    try {
      console.log('[OTP] Calling issuePhoneToken...');
      phoneToken = await issuePhoneToken(phone);
      console.log('[OTP] ✅ Phone token issued successfully. Token length:', phoneToken ? phoneToken.length : 'null');
    } catch (e) {
      console.error('[OTP] ❌ Error issuing phone token:', e.message);
      console.error('[OTP] Stack:', e.stack);
      phoneToken = null;
    }

    console.log('[OTP] About to send response. phoneToken is:', phoneToken ? 'SET' : 'NULL');

    // Load user's saved cards to return with OTP response
    let userData = null;
    try {
      console.log('[OTP] Loading user data for phone:', phone);
      const { data: usersData, error: usersError } = await supabase.from('kv_store').select('value').eq('key', 'cbp:users').single();

      if (usersError) {
        console.error('[OTP] Error fetching users:', usersError.message);
      } else if (usersData) {
        console.log('[OTP] Users data found, parsing...');
        const allUsers = JSON.parse(usersData.value);
        userData = allUsers[phone] || null;
        console.log('[OTP] User found:', userData ? 'Yes' : 'No', ', Cards:', userData ? userData.cards?.length || 0 : 0);
      } else {
        console.log('[OTP] No users data returned');
      }
    } catch (e) {
      console.error('[OTP] Error loading user data:', e.message);
    }

    const response = { success: true };
    if (phoneToken) {
      response.phoneToken = phoneToken;
      console.log('[OTP] Added phoneToken to response');
    }

    // Include saved cards in response so frontend can display them
    if (userData && userData.cards && userData.cards.length > 0) {
      response.savedCards = userData.cards;
      response.userName = userData.name;
      console.log('[OTP] Added', userData.cards.length, 'saved cards to response');
    }

    res.set('X-PhoneToken-Present', phoneToken ? 'yes' : 'no');
    res.json({
      success: true,
      phoneToken: phoneToken || null,
      savedCards: response.savedCards || [],
      userName: response.userName || null
    });
  } catch (e) {
    console.error('[OTP] Error:', e.message);
    res.status(500).json({ success: false, error: sanitizeError(e) });
  }
});

// ── Email integrations (Brevo / AWS SES / Gmail) ──
const WRITABLE_EMAIL_FIELDS = [
  'active_provider',
  'brevo_api_key', 'brevo_from_email', 'brevo_from_name',
  'ses_access_key_id', 'ses_secret_access_key', 'ses_region', 'ses_from_email',
  'gmail_address', 'gmail_app_password', 'gmail_from_name',
];

// Reads back the contact-form submissions stored by /api/contact. They were
// written as a safety net against a failing email provider, but nothing could
// read them, so the net was unreachable. Mirrors api/contact-messages.js.
app.get('/api/contact-messages', async (req, res) => {
  const auth = await checkAdminAccess(req);
  // 403 to match api/contact-messages.js - the browser treats them alike now,
  // but two answers to the same question is how that mismatch got missed.
  if (!auth.ok) return res.status(403).json({ error: auth.error });
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  try {
    const { data, error } = await supabase.from('kv_store').select('key,value').like('key', 'contact:%');
    if (error) throw new Error(error.message);
    const messages = [];
    for (const row of data || []) {
      let v;
      try { v = JSON.parse(row.value); } catch { continue; }
      messages.push({
        key: row.key,
        name: v.name || '', mobile: v.mobile || '', email: v.email || '',
        subject: v.subject || '', brief: v.brief || '',
        received_at: v.received_at || '', ip: v.ip || '',
      });
    }
    // Newest first; the key embeds the ISO timestamp so it sorts reliably.
    messages.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    res.json({ count: messages.length, messages: messages.slice(0, limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/email-settings', async (req, res) => {
  const auth = checkAdminKey(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  try {
    const row = await getSettings(supabase);
    res.json(maskSettings(row));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/email-settings', async (req, res) => {
  const auth = checkAdminKey(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  const body = req.body || {};
  const patch = {};
  for (const f of WRITABLE_EMAIL_FIELDS) {
    if (body[f] !== undefined && body[f] !== '') patch[f] = body[f];
  }
  if (body.active_provider === null) patch.active_provider = null;
  try {
    const row = await saveSettings(supabase, patch);
    res.json(maskSettings(row));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/email-settings/test', async (req, res) => {
  const auth = checkAdminKey(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  const { to, provider } = req.body || {};
  if (!to) return res.status(400).json({ error: 'A recipient email ("to") is required.' });
  try {
    const cfg = await getSettings(supabase);
    if (!cfg) return res.status(400).json({ error: 'No email provider has been configured yet.' });
    const result = await sendEmail(cfg, provider, {
      to,
      subject: 'BlockMyCard test email',
      html: '<p>This is a test email from your BlockMyCard admin console. If you got this, the connection works.</p>',
      text: 'This is a test email from your BlockMyCard admin console. If you got this, the connection works.',
    });
    res.json({ success: true, provider: result.provider });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// See api/login-email.js - needs headroom for the signup retries. Backed by
// the persistent store so a burst of retries right after a restart doesn't
// get a fresh allowance.
async function isLoginEmailRateLimited(phone) {
  const result = await checkAndRecord(supabase, 'login-email', phone, 5 * 60 * 1000, 15);
  return result.limited;
}

// Wording differs by event: a signup is expected and reassuring, a login on an
// existing account is the one worth flagging as "wasn't you?".
function buildLoginEmailMessage(event, user, phone, ts) {
  const greeting = `Hi${user.name ? ' ' + user.name : ''},`;
  if (event === 'registered') {
    return {
      subject: 'Welcome to BlockMyCard — your cards are saved',
      html: `<p>${greeting}</p><p>Your BlockMyCard account (${phone}) was created on ${ts}.</p><p>You can now save your card details so you can block them quickly if your wallet or phone is ever lost.</p>`,
      text: `Your BlockMyCard account (${phone}) was created on ${ts}. You can now save your card details so you can block them quickly if your wallet or phone is ever lost.`,
    };
  }
  return {
    subject: 'Security alert: new sign-in to BlockMyCard',
    html: `<p>${greeting}</p><p>Your BlockMyCard account (${phone}) was just logged into at ${ts}.</p><p>If this wasn't you, we recommend checking your saved cards and contact details right away.</p>`,
    text: `Your BlockMyCard account (${phone}) was just logged into at ${ts}. If this wasn't you, check your saved cards and contact details.`,
  };
}

app.post('/api/login-email', async (req, res) => {
  const { phone, ts, event } = req.body || {};
  if (!phone || !ts) return res.json({ ok: true, sent: false, reason: 'bad-request' });
  if (await isLoginEmailRateLimited(phone)) return res.json({ ok: true, sent: false, reason: 'rate-limited' });
  try {
    // See api/login-email.js - look up before claiming, so a signup whose email
    // has not been entered yet can still be retried once it is.
    const cfg = await getSettings(supabase);
    if (!cfg || !cfg.active_provider) return res.json({ ok: true, sent: false, reason: 'no-provider' });

    const { data: dir } = await supabase
      .from('user_directory').select('email, name').eq('phone', phone).maybeSingle();
    let user = dir && dir.email ? dir : null;
    if (!user) {
      const { data } = await supabase.from('kv_store').select('value').eq('key', 'cbp:users').single();
      if (data) { try { user = JSON.parse(data.value)[phone] || null; } catch (e) { user = null; } }
    }
    if (!user || !user.email) return res.json({ ok: true, sent: false, reason: 'no-email' });

    const claimed = await claimLoginEmail(supabase, phone, String(ts));
    if (!claimed) return res.json({ ok: true, sent: false, reason: 'duplicate' });
    await sendEmail(cfg, null, Object.assign({ to: user.email }, buildLoginEmailMessage(event, user, phone, ts)));
    res.json({ ok: true, sent: true });
  } catch (e) {
    console.error('[login-email] error:', e.message);
    res.json({ ok: true });
  }
});

// ── Contact us widget (see api/contact.js for the Vercel copy) ──
async function isContactRateLimited(ip) {
  const result = await checkAndRecord(supabase, 'contact', ip, 10 * 60 * 1000, 5);
  return result.limited;
}

app.post('/api/contact', async (req, res) => {
  const body = req.body || {};
  // Honeypot - answer as if it worked so a bot learns nothing.
  if (body.website) return res.json({ ok: true });

  // Limit before validating: the widget validates client-side, so anything
  // reaching here malformed is a non-browser caller worth throttling too.
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
  if (await isContactRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many messages sent. Please try again in a few minutes.' });
  }

  const { valid, errors, data } = validateContact(body);
  if (!valid) return res.status(400).json({ ok: false, error: errors[0] });

  const receivedAt = new Date().toISOString();
  const { error } = await supabase.from('kv_store').upsert(
    { key: storageKey(receivedAt), value: JSON.stringify(Object.assign({}, data, { received_at: receivedAt, ip })) },
    { onConflict: 'key' }
  );
  if (error) {
    console.error('[contact] store error:', error.message);
    return res.status(500).json({ ok: false, error: 'Could not save your message.' });
  }

  // Stored already, so a missing provider is not the sender's problem.
  try {
    const cfg = await getSettings(supabase);
    const to = contactRecipient();
    if (cfg && cfg.active_provider && to) {
      await sendEmail(cfg, null, Object.assign({ to }, buildContactEmail(data, receivedAt)));
    } else {
      console.log('[contact] stored but not emailed (no provider/recipient configured):', data.email);
    }
  } catch (e) {
    console.error('[contact] email error:', e.message);
  }

  res.json({ ok: true });
});

// ── Razorpay Admin Settings ──
app.get('/api/razorpay/settings', async (req, res) => {
  const auth = await checkAdminAccess(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  try {
    const settings = await getRazorpaySettings(supabase);
    res.json({ ok: true, data: maskRazorpaySettings(settings) });
  } catch (e) {
    console.error('[razorpay] get settings error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/razorpay/settings', async (req, res) => {
  const auth = await checkAdminAccess(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const { enabled, razorpay_key_id, razorpay_key_secret } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' });
  }

  try {
    const patch = { enabled };
    if (razorpay_key_id !== undefined) patch.razorpay_key_id = razorpay_key_id;
    if (razorpay_key_secret !== undefined) patch.razorpay_key_secret = razorpay_key_secret;

    const settings = await saveRazorpaySettings(supabase, patch);
    res.json({ ok: true, data: maskRazorpaySettings(settings) });
  } catch (e) {
    console.error('[razorpay] save settings error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get public Razorpay key (for frontend checkout)
app.get('/api/razorpay/public-key', async (req, res) => {
  try {
    const settings = await getRazorpaySettings(supabase);
    if (!settings || !settings.enabled || !settings.razorpay_key_id) {
      return res.status(503).json({ error: 'Razorpay is not configured' });
    }
    res.json({ key_id: settings.razorpay_key_id });
  } catch (e) {
    console.error('[razorpay] get public key error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Create Razorpay order (backend)
app.post('/api/razorpay/create-order', async (req, res) => {
  const { amount, description, phone } = req.body;

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  try {
    const settings = await getRazorpaySettings(supabase);
    if (!settings || !settings.enabled || !settings.razorpay_key_id || !settings.razorpay_key_secret) {
      return res.status(503).json({ error: 'Razorpay is not configured' });
    }

    const Razorpay = require('razorpay');
    const razorpay = new Razorpay({
      key_id: settings.razorpay_key_id,
      key_secret: settings.razorpay_key_secret
    });

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Convert to paise
      currency: 'INR',
      receipt: `order_${Date.now()}_${phone || 'guest'}`,
      description: description || 'BlockMyCard Premium'
    });

    res.json({ ok: true, order });
  } catch (e) {
    console.error('[razorpay] create order error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Verify Razorpay payment (backend)
app.post('/api/razorpay/verify-payment', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment details' });
  }

  try {
    const settings = await getRazorpaySettings(supabase);
    if (!settings || !settings.enabled || !settings.razorpay_key_secret) {
      return res.status(503).json({ error: 'Razorpay is not configured' });
    }

    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', settings.razorpay_key_secret);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const generated_signature = hmac.digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ ok: false, error: 'Payment verification failed' });
    }

    res.json({ ok: true, message: 'Payment verified successfully' });
  } catch (e) {
    console.error('[razorpay] verify payment error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Payment Settings (Free / Dummy / Razorpay / Cashfree / PayU / Easebuzz) ──
// The single admin-configured switch for the "save your cards" upsell in
// app.js. Only Razorpay has a real checkout backend today (the routes
// above); selecting Cashfree/PayU/Easebuzz here saves credentials for a
// future round to wire up - until then the frontend treats any gateway
// selection the same as 'dummy' (see app.js's savePrompt screen and
// GET /api/payment/mode below). Free and Dummy both work today: Free skips
// the fee entirely, Dummy is the simulated-fee behaviour this app has always
// had.
app.get('/api/payment/settings', async (req, res) => {
  const auth = await checkAdminAccess(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  try {
    const settings = await getPaymentSettings(supabase);
    res.json({ ok: true, data: maskPaymentSettings(settings) });
  } catch (e) {
    console.error('[payment] get settings error:', e.message);
    res.status(500).json({ error: sanitizeError(e) });
  }
});

app.post('/api/payment/settings', async (req, res) => {
  const auth = await checkAdminAccess(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const { mode } = req.body || {};
  if (mode !== undefined && !PAYMENT_MODES.includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode. Must be one of: ' + PAYMENT_MODES.join(', ') });
  }

  try {
    const patch = {};
    if (mode !== undefined) patch.mode = mode;
    // Credential fields: a blank/missing value means "keep whatever is
    // already saved" (same convention as lib/email-settings-store.js), so
    // switching modes never accidentally wipes a gateway's stored keys.
    for (const fields of Object.values(PAYMENT_GATEWAY_FIELDS)) {
      const idVal = req.body[fields.id];
      const secretVal = req.body[fields.secret];
      if (typeof idVal === 'string' && idVal.trim()) patch[fields.id] = idVal.trim();
      if (typeof secretVal === 'string' && secretVal.trim()) patch[fields.secret] = secretVal.trim();
    }

    const settings = await savePaymentSettings(supabase, patch);

    // Keep the existing (already-built, not-yet-wired-into-the-frontend)
    // Razorpay checkout backend in sync, so it's ready to go the moment a
    // future round connects it - no separate migration needed then.
    if (patch.mode !== undefined || patch.razorpay_key_id || patch.razorpay_key_secret) {
      const rpPatch = {};
      if (patch.mode !== undefined) rpPatch.enabled = (patch.mode === 'razorpay');
      if (patch.razorpay_key_id) rpPatch.razorpay_key_id = patch.razorpay_key_id;
      if (patch.razorpay_key_secret) rpPatch.razorpay_key_secret = patch.razorpay_key_secret;
      if (Object.keys(rpPatch).length) {
        await saveRazorpaySettings(supabase, rpPatch).catch((e) => console.error('[payment] razorpay sync failed:', e.message));
      }
    }

    res.json({ ok: true, data: maskPaymentSettings(settings) });
  } catch (e) {
    console.error('[payment] save settings error:', e.message);
    res.status(500).json({ error: sanitizeError(e) });
  }
});

// Public, no secrets: the frontend needs to know whether to show the fee at
// all. Fails safe to 'dummy' - the app's existing, already-shipped behaviour
// - so any error here never silently changes what a user sees.
app.get('/api/payment/mode', async (req, res) => {
  try {
    const settings = await getPaymentSettings(supabase);
    res.json({ mode: (settings && PAYMENT_MODES.includes(settings.mode)) ? settings.mode : 'dummy' });
  } catch (e) {
    res.json({ mode: 'dummy' });
  }
});

// ── Inject storage bridge into index.html ──
function sendApp(req, res) {
  let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const bridge = '<script>\n(function() {\n  window.__bmc_dummy_mode = true;\n  window.storage = {\n    get: async function(key) {\n      try { const r = await fetch(\'/api/storage?key=\' + encodeURIComponent(key)); if (!r.ok) return null; return r.json(); } catch(e) { return null; }\n    },\n    set: async function(key, value) {\n      try { const r = await fetch(\'/api/storage\', { method: \'POST\', headers: {\'Content-Type\':\'application/json\'}, body: JSON.stringify({ key, value }) }); return r.json(); } catch(e) { return null; }\n    },\n    delete: async function(key) {\n      try { const r = await fetch(\'/api/storage?key=\' + encodeURIComponent(key), { method: \'DELETE\' }); return r.json(); } catch(e) { return null; }\n    },\n    list: async function(prefix) {\n      try { const url = \'/api/storage/list\' + (prefix ? \'?prefix=\' + encodeURIComponent(prefix) : \'\'); const r = await fetch(url); return r.json(); } catch(e) { return { keys: [] }; }\n    }\n  };\n})();\n</script>';
  html = html.replace('<head>', '<head>' + bridge);
  res.send(html);
}
app.get('/', sendApp);

// ── Static files ──
app.use(express.static(__dirname));

// ── SPA fallback: unmatched routes like /login or /dashboard render the app instead of a raw 404 ──
app.get(/^\/(?!api\/).*/, sendApp);

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('');
  console.log('  BlockMyCard running at http://localhost:' + PORT);
  console.log('  Supabase: ' + supabaseUrl);
  console.log('  OTP mode: ' + (process.env.OTP_MODE === 'dummy' ? 'DUMMY (use 1234)' : 'LIVE (Twilio)'));
  console.log('');

  if (!process.env.OTP_SECRET) {
    console.log('  WARNING: OTP_SECRET is not set - phone tokens (login sessions, admin phone-login) cannot be issued or verified.');
  }
  if (!process.env.ADMIN_PHONE && !process.env.ADMIN_API_SECRET) {
    console.log('  WARNING: neither ADMIN_PHONE nor ADMIN_API_SECRET is set - the admin console is completely unreachable until one is configured.');
  }

  // Check if kv_store table exists
  const { error } = await supabase.from('kv_store').select('key').limit(1);
  if (error && error.code === '42P01') {
    console.log('  WARNING: kv_store table missing!');
    console.log('  Run this in Supabase SQL editor:');
    console.log('  CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());');
  } else if (error) {
    console.log('  DB error:', error.message);
  } else {
    console.log('  Database: Supabase kv_store OK');
  }

  // Check if the email-integration tables exist
  const { error: emailErr } = await supabase.from('email_settings').select('id').limit(1);
  if (emailErr && (emailErr.code === '42P01' || emailErr.code === 'PGRST205')) {
    console.log('  WARNING: email_settings/login_email_log tables missing!');
    console.log('  Run this in Supabase SQL editor:');
    console.log(`  CREATE TABLE email_settings (
    id INT PRIMARY KEY DEFAULT 1, active_provider TEXT,
    brevo_api_key TEXT, brevo_from_email TEXT, brevo_from_name TEXT,
    ses_access_key_id TEXT, ses_secret_access_key TEXT, ses_region TEXT, ses_from_email TEXT,
    gmail_address TEXT, gmail_app_password TEXT, gmail_from_name TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(), CONSTRAINT email_settings_singleton CHECK (id = 1));
  ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;
  CREATE TABLE login_email_log (phone TEXT NOT NULL, ts TEXT NOT NULL, sent_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (phone, ts));
  ALTER TABLE login_email_log ENABLE ROW LEVEL SECURITY;`);
  } else if (!emailErr) {
    console.log('  Database: email_settings/login_email_log OK');
  }

  // Check if the razorpay_settings table exists
  const { error: rzpErr } = await supabase.from('razorpay_settings').select('id').limit(1);
  if (rzpErr && (rzpErr.code === '42P01' || rzpErr.code === 'PGRST205')) {
    console.log('  WARNING: razorpay_settings table missing!');
    console.log('  Run this in Supabase SQL editor:');
    console.log(`  CREATE TABLE razorpay_settings (
    id INT PRIMARY KEY DEFAULT 1, enabled BOOLEAN DEFAULT false,
    razorpay_key_id TEXT, razorpay_key_secret TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(), CONSTRAINT razorpay_settings_singleton CHECK (id = 1));
  ALTER TABLE razorpay_settings ENABLE ROW LEVEL SECURITY;`);
  } else if (!rzpErr) {
    console.log('  Database: razorpay_settings OK');
  }

  if (!process.env.ADMIN_API_SECRET) {
    console.log('  WARNING: ADMIN_API_SECRET is not set - email integration admin endpoints will reject all requests unless the caller has an admin phone token.');
  }
});
