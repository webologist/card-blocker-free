// lib/cors.js
// Shared CORS allowlist for every API route (server.js and pages/api/*.ts).
//
// Every route used to answer with Access-Control-Allow-Origin: * (and
// server.js's `app.use(cors())` reflects any Origin by default when given no
// options), which let any website's own JavaScript call these APIs
// cross-origin - including the admin/payment/PII endpoints. None of this
// app's own pages actually need that: a page loaded from blockmycard.in
// calls blockmycard.in same-origin, and same-origin requests aren't subject
// to CORS at all. This allowlist exists only for origins that genuinely need
// cross-origin access (local dev on a different port today; add real
// partner origins via ALLOWED_ORIGINS if that's ever needed).

const DEFAULT_ORIGINS = [
  'https://blockmycard.in',
  'https://www.blockmycard.in',
  'http://localhost:3000',
  'http://localhost:3001',
];

function allowedOrigins() {
  const extra = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

// For the Express `cors` middleware's `origin` option (server.js). Requests
// with no Origin header at all (same-origin page loads, curl, server-to-
// server calls) are always allowed - Origin is only sent by cross-origin
// browser requests, which is exactly what this is gating.
function corsOriginCheck(origin, callback) {
  if (!origin) return callback(null, true);
  callback(null, allowedOrigins().has(origin));
}

// For Next.js API routes (pages/api/*.ts), called at the top of the handler
// in place of the old unconditional res.setHeader('Access-Control-Allow-Origin', '*').
function applyCors(req, res, methods) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods || 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-phone-token, x-admin-key');
}

module.exports = { allowedOrigins, corsOriginCheck, applyCors };
