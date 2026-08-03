require('dotenv').config({ path: '.env.db' });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { checkAdminKey, checkAdminAccess } = require('./lib/admin-auth');
const { issuePhoneToken } = require('./lib/phone-token');

console.log('🔧 [STARTUP] server.js loaded with phoneToken support');
const { getSettings, saveSettings, claimLoginEmail } = require('./lib/email-settings-store');
const { getSettings: getRazorpaySettings, saveSettings: saveRazorpaySettings, maskSettings: maskRazorpaySettings } = require('./lib/razorpay-settings-store');
const { sendEmail, maskSettings } = require('./lib/email-providers');
const { validateContact, buildContactEmail, contactRecipient, storageKey } = require('./lib/contact');

const app = express();
app.use(cors());
app.use(express.json());

// ── Supabase client ──
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

console.log('Supabase URL:', supabaseUrl);
console.log('Key loaded:', !!supabaseKey);

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Storage API (mimics Vercel KV window.storage) ──
app.get('/api/storage', async (req, res) => {
  const { key } = req.query;
  if (!key) {
    const { data } = await supabase.from('kv_store').select('key');
    return res.json({ keys: (data || []).map(r => r.key) });
  }
  const { data } = await supabase.from('kv_store').select('value').eq('key', key).single();
  if (!data) return res.json(null);
  res.json({ key, value: data.value });
});

app.post('/api/storage', async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  const { error } = await supabase
    .from('kv_store')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ key, value });
});

app.delete('/api/storage', async (req, res) => {
  const { key } = req.query;
  await supabase.from('kv_store').delete().eq('key', key);
  res.json({ key, deleted: true });
});

app.get('/api/storage/list', async (req, res) => {
  const { prefix } = req.query;
  let query = supabase.from('kv_store').select('key');
  if (prefix) query = query.like('key', prefix + '%');
  const { data } = await query;
  res.json({ keys: (data || []).map(r => r.key) });
});

// ── OTP routes ──
app.post('/api/send-otp', async (req, res) => {
  console.log('🎯 [SEND-OTP ENDPOINT HIT]');
  const { phone } = req.body;
  // Server decision only - a client-supplied dummyMode let any caller skip
  // OTP verification for any phone number.
  const isDummy = process.env.OTP_MODE === 'dummy';
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
    res.status(500).json({ error: 'Could not send OTP' });
  }
});

app.post('/api/verify-otp', async (req, res) => {
  console.log('🎯 [ENDPOINT HIT] /api/verify-otp called');
  const { phone, otp, token } = req.body;
  const { data } = await supabase.from('kv_store').select('value').eq('key', 'otp:' + phone).single();
  if (!data) return res.status(400).json({ success: false, error: 'No OTP sent for this number' });
  const entry = JSON.parse(data.value);
  if (Date.now() > entry.expires) return res.status(400).json({ success: false, error: 'OTP expired' });
  if (otp !== entry.otp || token !== entry.token) return res.status(400).json({ success: false, error: 'Incorrect OTP' });
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
  const response = { success: true };
  if (phoneToken) {
    response.phoneToken = phoneToken;
    console.log('[OTP] Added phoneToken to response');
  }
  // Test if this code is running - add a field to the response
  response.codeExecuted = true;
  response.phoneLengthReceived = phone ? phone.length : 0;

  res.set('X-PhoneToken-Present', phoneToken ? 'yes' : 'no');
  res.json({
    success: true,
    phoneToken: phoneToken || null,
    testField: 'MY_CODE_RUNS_' + Math.random()
  });
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

// See api/login-email.js - needs headroom for the signup retries.
const loginEmailRateLimit = new Map();
function isLoginEmailRateLimited(phone) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const hits = (loginEmailRateLimit.get(phone) || []).filter((t) => now - t < windowMs);
  if (hits.length >= 15) return true;
  hits.push(now);
  loginEmailRateLimit.set(phone, hits);
  return false;
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
  if (isLoginEmailRateLimited(phone)) return res.json({ ok: true, sent: false, reason: 'rate-limited' });
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
const contactRateLimit = new Map();
function isContactRateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const hits = (contactRateLimit.get(ip) || []).filter((t) => now - t < windowMs);
  if (hits.length >= 5) return true;
  hits.push(now);
  contactRateLimit.set(ip, hits);
  return false;
}

app.post('/api/contact', async (req, res) => {
  const body = req.body || {};
  // Honeypot - answer as if it worked so a bot learns nothing.
  if (body.website) return res.json({ ok: true });

  // Limit before validating: the widget validates client-side, so anything
  // reaching here malformed is a non-browser caller worth throttling too.
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
  if (isContactRateLimited(ip)) {
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
  console.log('  OTP mode: DUMMY (use 1234)');
  console.log('');

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
    console.log('  WARNING: ADMIN_API_SECRET is not set - email integration admin endpoints will reject all requests.');
  }
});