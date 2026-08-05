// Input validation middleware for API endpoints
// Prevents malformed requests and injection attacks

function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  // Allow international format: +91, +1, etc. or 10-digit local
  // Minimum 10 digits, maximum 15 (E.164 standard)
  const normalized = phone.replace(/\D/g, '');
  return normalized.length >= 10 && normalized.length <= 15;
}

function validateOTP(otp) {
  if (!otp || typeof otp !== 'string') return false;
  // OTP should be 4-6 digits
  return /^\d{4,6}$/.test(otp);
}

function validateToken(token) {
  if (!token || typeof token !== 'string') return false;
  // Token should be non-empty string with dots (JWT format)
  return token.includes('.');
}

function sanitizeError(error) {
  // Only reveal generic messages, never implementation details
  if (!error) return 'An error occurred';

  // Never expose stack traces or internal details
  const message = error.message || String(error);

  // Map specific errors to generic messages
  if (message.includes('ECONNREFUSED')) return 'Database connection failed';
  if (message.includes('timeout')) return 'Request timeout';
  if (message.includes('ENOTFOUND')) return 'Service unavailable';

  // For database errors, be extra vague
  if (message.includes('query') || message.includes('SQL')) return 'Database error';

  // Generic fallback
  return 'An error occurred. Please try again.';
}

module.exports = {
  validatePhone,
  validateOTP,
  validateToken,
  sanitizeError
};
