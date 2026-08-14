// lib/otp-mode.js
// Decides whether an OTP request is served in dummy mode (any number, OTP
// "1234") or for real. Shared by send-otp and verify-otp so the two can never
// disagree - a mismatch there would either issue a token nobody can use, or
// accept one nobody should have.
//
// Dummy mode is a development affordance. Honouring it on a production
// deployment means "1234" is accepted as proof of ownership for ANY phone
// number, which makes every account reachable by anyone. So the environment
// gets the final say over the flag: on a production deployment the flag alone
// is not enough.
//
// OTP_DUMMY_NUMBERS opts specific numbers back in - the published demo
// accounts, so the product can be shown without an SMS spend - and is empty by
// default, meaning production is closed unless someone deliberately opens a
// listed number.

function normalize(v) {
  const digits = String(v || '').replace(/\D/g, '').replace(/^91/, '');
  return digits ? '+91' + digits : '';
}

function isProductionDeployment() {
  // Vercel sets this to "production" only for the production target; preview
  // and development deployments get "preview"/"development".
  return process.env.VERCEL_ENV === 'production';
}

function dummyNumbers() {
  return String(process.env.OTP_DUMMY_NUMBERS || '')
    .split(',')
    .map((s) => normalize(s))
    .filter(Boolean);
}

// DUMMY MODE IS DELIBERATELY OPEN ON PRODUCTION.
//
// Set on 2026-07-30 at the owner's explicit request, after being told plainly
// what it means: anyone can sign in as ANY phone number using the code 1234.
// No SMS is sent and no ownership of the number is proved. Every account on
// the site is reachable by anyone who knows a phone number.
//
// It is a named constant rather than an env var on purpose - it shows up in
// git history and in a grep, so whoever reads this next cannot mistake it for
// an accident or a leftover.
//
// TO CLOSE IT: set this to false. Nothing else needs to change - the
// OTP_DUMMY_NUMBERS allowlist below then takes over, so the demo accounts can
// keep working without leaving every other number exposed.
const ALLOW_DUMMY_ON_PRODUCTION = true;

// fullPhone is optional: pass it where the number is known, so production can
// allow the listed demo accounts. Called without one (a "is dummy mode on at
// all?" question) production answers no unless dummy mode is fully open.
function isDummyMode(fullPhone) {
  if (process.env.OTP_MODE !== 'dummy') return false;
  if (!isProductionDeployment()) return true;
  if (ALLOW_DUMMY_ON_PRODUCTION) return true;
  return fullPhone ? dummyNumbers().includes(normalize(fullPhone)) : false;
}

// The admin console's OTP-mode switch (cbp:otp_mode in kv_store) used to
// write a value nothing ever read - server.js and the API routes only ever
// consulted the environment, so the toggle was a placebo that looked like a
// real control.
//
// `toggle` is that stored value ('dummy' | 'live' | unset). It is
// deliberately one-directional: it can turn dummy mode OFF (force live
// Twilio for a test) even while OTP_MODE=dummy, but it can never turn dummy
// mode ON beyond what isDummyMode() above already permits. An admin-panel
// button is reachable by anyone who can reach the admin panel (see
// lib/admin-auth.js) - that is an acceptable amount of trust for "let me
// test the real SMS path right now," and not an acceptable amount of trust
// for "let me reopen every account to code 1234," which is the one thing
// this app spent real effort locking down (see the pre-launch audit's C2).
function resolveDummyMode(fullPhone, toggle) {
  if (!isDummyMode(fullPhone)) return false;
  if (toggle === 'live') return false;
  return true;
}

module.exports = { isDummyMode, resolveDummyMode, isProductionDeployment, dummyNumbers, normalize };
