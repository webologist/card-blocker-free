// qa/harness.js
// Local test harness for the QA suite in QA-TEST-CASES.md.
//
//   node qa/harness.js        → http://localhost:4321
//   QA_ENV=preview node qa/harness.js   → exercises the non-production branches
//
// Serves the working tree and stands in for the two Vercel functions the OTP
// flow needs. It loads the REAL lib/otp-token.js, lib/otp-mode.js and
// lib/phone-token.js, so the token rules under test are the ones that ship -
// only the transport is stubbed.
//
// Nothing here reaches Supabase, Twilio, or the production database, which is
// the point: the alternate-contact and account-overwrite cases (ALT-LOG-05..08)
// need to seed and destroy account records, and that is not something to do
// against live data.
//
// VERCEL_ENV defaults to "production" so the suite tests the branch real users
// hit - in particular that the wrong-OTP reply does not leak the dummy code.
// Set QA_ENV=preview to check the development-only messaging instead.
//
// window.storage is left alone deliberately. app.js falls back to localStorage
// when nothing defines it, which is exactly what production does today
// (BUG-01), so seeding state means writing localStorage directly - see the
// automation notes in QA-TEST-CASES.md.

process.env.OTP_MODE = 'dummy';
process.env.VERCEL_ENV = process.env.QA_ENV || 'production';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.QA_PORT) || 4321;

const { issueOtpToken, readOtpToken } = require(path.join(ROOT, 'lib/otp-token'));
const { isDummyMode, isProductionDeployment } = require(path.join(ROOT, 'lib/otp-mode'));
const { issuePhoneToken } = require(path.join(ROOT, 'lib/phone-token'));

// Per-process, like the real handlers' in-memory maps.
const sendHits = new Map();
const attemptMap = new Map();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Mirrors api/send-otp.js: validate, throttle, then issue a challenge whose
// payload carries a phone-bound HMAC of the code rather than the code itself.
async function sendOtp(req, res) {
  const { phone } = await readBody(req);
  const digits = String(phone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return json(res, 400, { error: 'Invalid phone number. Enter a 10-digit Indian mobile number starting with 6-9.' });
  }
  const now = Date.now();
  const hits = (sendHits.get(digits) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (hits.length >= 3) return json(res, 429, { error: 'Too many OTP requests. Please wait 10 minutes.' });
  hits.push(now);
  sendHits.set(digits, hits);

  const fullPhone = '+91' + digits;
  if (!isDummyMode(fullPhone)) {
    return json(res, 500, { error: 'Harness runs in dummy mode only; live Twilio is not stubbed.' });
  }
  const token = await issueOtpToken({ phone: fullPhone, otp: '1234', expiresAt: now + 5 * 60 * 1000, dummy: true });
  console.log('[send-otp]', fullPhone);
  return json(res, 200, { success: true, token, _dummy: true });
}

// Mirrors the patched dummy branch in api/verify-otp.js: the code has to answer
// a challenge this process issued for this number, wrong guesses count, and the
// hint is withheld on a production deployment.
async function verifyOtp(req, res) {
  const { phone, otp, token } = await readBody(req);
  if (!phone || !otp || !token) return json(res, 400, { error: 'Phone, OTP and token are required' });

  const fullPhone = '+91' + String(phone).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!isDummyMode(fullPhone)) return json(res, 500, { error: 'OTP service not configured.' });

  let challenge;
  try { challenge = await readOtpToken(token); }
  catch { return json(res, 400, { error: 'Please tap Send OTP first.' }); }
  if (!challenge.dummy || challenge.phone !== fullPhone) return json(res, 400, { error: 'Phone number mismatch.' });
  if (Date.now() > challenge.expiresAt) return json(res, 400, { error: 'OTP has expired.' });

  const tries = attemptMap.get(token) || 0;
  if (tries >= 5) return json(res, 429, { error: 'Too many incorrect attempts. Please request a new OTP.' });

  if (String(otp).trim() === '1234') {
    attemptMap.delete(token);
    console.log('[verify-otp] ok', fullPhone);
    return json(res, 200, { success: true, phoneToken: await issuePhoneToken(fullPhone) });
  }
  attemptMap.set(token, tries + 1);
  return json(res, 400, {
    error: isProductionDeployment() ? 'Incorrect OTP. Please try again.' : 'Incorrect OTP. Hint: dummy OTP is 1234.',
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/send-otp') return sendOtp(req, res);
  if (url.pathname === '/api/verify-otp') return verifyOtp(req, res);

  // Endpoints the page polls but the harness does not model. Answering rather
  // than 404-ing keeps the console clean, so a real error still stands out.
  if (url.pathname.startsWith('/api/')) return json(res, 200, { ok: true, sent: false, reason: 'stubbed' });

  const file = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const full = path.normalize(path.join(ROOT, file));
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }

  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`QA harness on http://localhost:${PORT}  (VERCEL_ENV=${process.env.VERCEL_ENV}, OTP 1234)`);
});
