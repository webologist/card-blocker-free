// lib/rate-limit-store.js
// Sliding-window rate limiting backed by Supabase's kv_store table, so
// limits survive process restarts and serverless cold starts.
//
// Every limiter in this app used to be a plain in-memory Map. That resets on
// every deploy, every server.js restart, and (on Vercel) potentially every
// cold start - an attacker distributed across a few invocations effectively
// saw no limit at all. Storing the hit history in the database instead of
// process memory closes that gap; it costs one read+write per request
// instead of a Map lookup, which is the right trade for an auth-adjacent
// control.
//
// Entries live under `ratelimit:<scope>:<key>` as a JSON array of hit
// timestamps (ms since epoch), pruned to the current window on every check.
// This key pattern is never exposed through the public /api/storage
// endpoint - lib/storage-policy.js's isAddressable() only recognises
// PUBLIC_KEYS/OWNED_KEYS/ADMIN_KEYS, so a "ratelimit:*" key is rejected if
// anyone ever tries to read or write it that way.

async function checkAndRecord(supabase, scope, key, windowMs, maxHits) {
  const rowKey = `ratelimit:${scope}:${key}`;
  const now = Date.now();

  const { data } = await supabase.from('kv_store').select('value').eq('key', rowKey).single();
  let hits = [];
  if (data && data.value) {
    try {
      hits = JSON.parse(data.value);
    } catch (e) {
      hits = [];
    }
  }
  hits = (Array.isArray(hits) ? hits : []).filter((t) => now - t < windowMs);

  if (hits.length >= maxHits) {
    const retryAfterMs = Math.max(0, hits[0] + windowMs - now);
    return { limited: true, remaining: 0, retryAfterMs };
  }

  hits.push(now);
  await supabase.from('kv_store').upsert(
    { key: rowKey, value: JSON.stringify(hits) },
    { onConflict: 'key' }
  );
  return { limited: false, remaining: maxHits - hits.length, retryAfterMs: 0 };
}

// Express middleware factory (server.js). `getSupabase` is a function rather
// than a client instance so this can be required before the client exists.
// On any store error (network hiccup, table briefly unavailable) this fails
// OPEN - i.e. lets the request through rather than 500ing every auth
// request because the rate-limit store had one bad moment. That is a
// deliberate availability/security trade-off for a secondary control; the
// primary controls (OTP verification itself, storage-policy access checks)
// do not have this fallback.
function expressRateLimiter(getSupabase, { scope, windowMs, maxRequests, keyGenerator }) {
  return async (req, res, next) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return next();
      const key = keyGenerator(req);
      const result = await checkAndRecord(supabase, scope, key, windowMs, maxRequests);
      res.set('X-RateLimit-Limit', String(maxRequests));
      res.set('X-RateLimit-Remaining', String(result.remaining));
      if (result.limited) {
        console.warn(`[RATE-LIMIT] Blocked ${scope}:${key}`);
        return res.status(429).json({
          error: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil(result.retryAfterMs / 1000),
        });
      }
      next();
    } catch (e) {
      console.error('[RATE-LIMIT] store error, allowing request through:', e.message);
      next();
    }
  };
}

module.exports = { checkAndRecord, expressRateLimiter };
