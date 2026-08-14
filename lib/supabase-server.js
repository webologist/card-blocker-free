// lib/supabase-server.js
// Lazily-created Supabase client for pages/api routes.
//
// server.js has always built its own client at startup; the Next.js API
// routes (pages/api/*.ts) had none at all, which is why pages/api/storage.ts
// was a non-persisting stub and pages/api/send-otp.ts could only rate-limit
// and read config from process memory. This gives those routes the same
// database access, built the same way (service-role key preferred, anon key
// as a fallback so local dev without a service key still works).
//
// Returns null - never throws - if neither URL nor key is configured, so
// callers can degrade gracefully (e.g. fall back to in-memory rate limiting)
// instead of 500ing every request when Supabase env vars are missing.

let cached = null;
let attempted = false;

function getSupabaseServerClient() {
  if (cached) return cached;
  if (attempted) return null;
  attempted = true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('[supabase-server] No Supabase URL/key configured - DB-backed features (persistent rate limits, OTP-mode toggle) are unavailable in this deployment.');
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient } = require('@supabase/supabase-js');
  cached = createClient(url, key);
  return cached;
}

module.exports = { getSupabaseServerClient };
