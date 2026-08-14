// lib/admin-auth.js
// Lightweight shared-secret gate for the email-integration admin endpoints.
// This app has no real server-side session system (OTP just flips client
// state), so this is a pragmatic header check, not a full auth system -
// set ADMIN_API_SECRET in the environment to enable it.

const { verifyPhoneToken } = require('./phone-token');

// The console is reached by completing OTP on this number, so a token the
// server itself signed for it is proof of the same thing the shared secret
// proves.
//
// This used to fall back to a phone number hardcoded in this file when
// ADMIN_PHONE wasn't set, which meant the admin number was effectively
// public (anyone reading the source knew it). There is no safe default for
// "who is the admin" - if ADMIN_PHONE isn't configured, the phone-token path
// is simply unavailable, not open to a guessable fallback.
function adminPhone() {
  return process.env.ADMIN_PHONE || null;
}

function sameNumber(a, b) {
  const digits = (s) => String(s || '').replace(/[^0-9]/g, '').slice(-10);
  const left = digits(a);
  return left.length === 10 && left === digits(b);
}

// Whether an already-verified phone (from verifyPhoneToken) is the admin
// number. Used by /api/storage's cbp:users handling so the admin console can
// see and manage every registered user - the ownership scoping in
// lib/storage-policy.js's usersMapFor()/writableRecords() is deliberately
// per-caller for everyone else, but has no notion of "admin", so without this
// the admin's own view of cbp:users is filtered exactly like a regular user's
// and only ever shows the admin number's own record (usually none at all).
function isAdminPhone(phone) {
  const admin = adminPhone();
  return !!admin && sameNumber(phone, admin);
}

function checkAdminKey(req) {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return { ok: false, error: 'ADMIN_API_SECRET is not configured on the server.' };
  const got = req.headers['x-admin-key'];
  if (got !== expected) return { ok: false, error: 'Invalid admin key.' };
  return { ok: true };
}

// Either the shared secret - which scripts and curl still use - or an OTP
// phone token belonging to the admin number, which the browser already holds
// after signing in. The second path is what lets the admin console read its
// own data without asking for a key it has no way to remember.
//
// Note this is only as strong as the OTP that issued the token - if the
// deployment's OTP flow is ever in dummy mode (see lib/otp-mode.js) for the
// admin number, anyone can mint one. Fixing that is a deployment-config
// decision (see the audit's H1), not something this function can enforce.
async function checkAdminAccess(req) {
  const key = checkAdminKey(req);
  if (key.ok) return key;

  const admin = adminPhone();
  if (!admin) {
    return { ok: false, error: 'Admin access is not configured. Set ADMIN_API_SECRET or ADMIN_PHONE on the server.' };
  }

  // Try to verify phone token, but handle case where OTP_SECRET is not set
  let phone = null;
  try {
    phone = await verifyPhoneToken(req.headers['x-phone-token']);
  } catch (e) {
    // OTP_SECRET not set - token verification unavailable
    phone = null;
  }

  if (phone && sameNumber(phone, admin)) return { ok: true, via: 'phone' };

  return { ok: false, error: 'Invalid admin key or phone token.' };
}

module.exports = { checkAdminKey, checkAdminAccess, isAdminPhone };
