// Rate limiting middleware to prevent brute force attacks
// Tracks requests per IP address with sliding window

const activeLimits = new Map();

function createRateLimiter(options = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    maxRequests = 5,
    keyGenerator = (req) => req.ip || req.connection.remoteAddress || 'unknown'
  } = options;

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();

    if (!activeLimits.has(key)) {
      activeLimits.set(key, { attempts: [] });
    }

    const data = activeLimits.get(key);

    // Remove expired attempts
    data.attempts = data.attempts.filter(t => now - t < windowMs);

    const remaining = maxRequests - data.attempts.length;

    if (data.attempts.length >= maxRequests) {
      console.warn(`[RATE-LIMIT] Blocked ${key} - too many attempts (${data.attempts.length})`);
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((Math.min(...data.attempts) + windowMs - now) / 1000)
      });
    }

    // Record this request
    data.attempts.push(now);

    // Store remaining attempts in response header
    res.set('X-RateLimit-Limit', maxRequests);
    res.set('X-RateLimit-Remaining', remaining);
    res.set('X-RateLimit-Reset', new Date(now + windowMs).toISOString());

    console.log(`[RATE-LIMIT] ${key}: ${data.attempts.length}/${maxRequests} attempts`);

    next();
  };
}

module.exports = { createRateLimiter };
