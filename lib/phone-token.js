// lib/phone-token.js
// A short-lived, HMAC-signed proof that the server itself verified ownership
// of a phone number during OTP. Issued only by the OTP verify endpoint on a
// genuine success, and required before that phone's email address can be
// recorded in the server-side directory.
//
// This exists because the browser cannot be trusted to say "phone X belongs to
// me" - without it, anyone could register an arbitrary email against anyone's
// number and make the app email a stranger.
//
// FIX (13 Aug 2026): hmac() used to call the bare global `crypto.subtle`
// (the browser/Web Crypto API) with no import at all. That global only
// exists in Node without a flag from v19+ (stable from v20); on any older
// or differently-configured Node runtime, `crypto` is undefined here and
// issuePhoneToken() throws. server.js's /api/verify-otp catches that error
// and silently omits phoneToken from its response - the client never
// receives one, so it's never stored, so every subsequent /api/storage call
// (saved cards, activity log, admin users grid) has no x-phone-token header
// and 401s with "Sign in required". Registration and login still appeared
// to work end to end because nothing in that path checks for a token - the
// data just never reached the database. Symptom matched exactly: same-
// browser React state looked fine, Admin -> Users showed nobody, and the
// console showed continuous storage.set(...) 401 errors.
//
// Switched to Node's built-in `crypto` module (`createHmac`), which has
// shipped HMAC-SHA256 support since Node 0.x and needs no global/feature
// detection at all - this is the same guarantee `readRow`/`writeRow` get
// from requiring '@supabase/supabase-js' directly rather than assuming a
// global.

const nodeCrypto = require('crypto');

const TTL_MS = 15 * 60 * 1000; // long enough to finish signup, short enough to not linger

function secret() {
  if (!process.env.OTP_SECRET) {
    throw new Error('OTP_SECRET environment variable is not set. Phone token functionality disabled.');
  }
  return process.env.OTP_SECRET;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
}

async function hmac(data) {
  const sig = nodeCrypto.createHmac('sha256', secret()).update(data).digest();
  return b64url(sig);
}

async function issuePhoneToken(phone) {
  const payload = JSON.stringify({ phone, exp: Date.now() + TTL_MS });
  const body = b64url(payload);
  return body + '.' + (await hmac(body));
}

// Returns the verified phone, or null if the token is missing, malformed,
// tampered with, or expired. Never throws.
async function verifyPhoneToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let expected;
  try { expected = await hmac(body); } catch { return null; }
  // Constant-time-ish compare: lengths match and no early exit on first diff.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  let data;
  try { data = JSON.parse(fromB64url(body)); } catch { return null; }
  if (!data || !data.phone || !data.exp) return null;
  if (Date.now() > data.exp) return null;
  return data.phone;
}

module.exports = { issuePhoneToken, verifyPhoneToken };
