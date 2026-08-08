const { issuePhoneToken } = require('../lib/phone-token');

const attemptMap = new Map();
const usedTokens = new Map();

function isTokenUsed(token) {
  const exp = usedTokens.get(token);
  if (exp === undefined) return false;
  if (Date.now() > exp) { usedTokens.delete(token); return false; }
  return true;
}

// The signature only ever proved the token had not been altered - it did not
// stop anyone reading it, and the OTP was sitting in the payload. The code is
// now stored as a phone-bound HMAC, so the token can be read all day without
// revealing anything usable. See lib/otp-token.js.
const { readOtpToken, otpMatches } = require('../lib/otp-token');

// Dummy mode is a SERVER decision only. Honouring a client-supplied
// `dummyMode` flag let any caller skip OTP verification entirely for any
// phone number, which also made "the phone was OTP-verified" worthless as a
// trust signal for anything built on top of it.
//
// The environment flag alone is no longer enough either: OTP_MODE=dummy was
// set on production, so "1234" verified ANY number and minted a real
// phoneToken for it. lib/otp-mode.js now refuses that on a production
// deployment unless the number is explicitly listed in OTP_DUMMY_NUMBERS.
const { isDummyMode, isProductionDeployment } = require('../lib/otp-mode');

const ALLOWED_ORIGINS = ['https://card-blocker.vercel.app', 'https://card-blocker-free.vercel.app', 'http://localhost:3000', 'http://localhost:3001'];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, otp, token } = req.body || {};
  if (!phone || !otp || !token) return res.status(400).json({ error: 'Phone, OTP and token are required' });

  const digits = phone.replace(/\D/g, '').replace(/^91/, '');
  const fullPhone = '+91' + digits;

  if (isDummyMode(fullPhone)) {
    // A dummy code still has to answer a challenge THIS server issued for THIS
    // number. Without that check the endpoint minted a phone token for any
    // number from a request that had never been anywhere near send-otp, so the
    // 3-per-10-minutes limit there bounded nothing: no send, no throttle, no
    // Twilio, just tokens on demand for arbitrary numbers.
    let challenge;
    try { challenge = await readOtpToken(token); }
    catch { return res.status(400).json({ error: 'Please tap Send OTP first.' }); }
    if (!challenge.dummy || challenge.phone !== fullPhone) return res.status(400).json({ error: 'Phone number mismatch.' });
    if (Date.now() > challenge.expiresAt) return res.status(400).json({ error: 'OTP has expired.' });

    const dummyAttempts = attemptMap.get(token) || 0;
    if (dummyAttempts >= 5) return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new OTP.' });

    if (otp.toString().trim() === '1234') {
      attemptMap.delete(token);
      return res.status(200).json({ success: true, phoneToken: await issuePhoneToken(fullPhone) });
    }
    attemptMap.set(token, dummyAttempts + 1);
    // The hint is a development affordance. On a production deployment it was
    // handing every visitor the master code in a toast - dummy mode is open
    // here deliberately (see lib/otp-mode.js), but that is a reason to stop
    // advertising it, not to advertise it louder.
    return res.status(400).json({
      error: isProductionDeployment()
        ? 'Incorrect OTP. Please try again.'
        : 'Incorrect OTP. Hint: dummy OTP is 1234.',
    });
  }

  if (token.startsWith('verify:')) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
    if (!serviceSid || !accountSid || !authToken) {
      return res.status(500).json({ error: 'OTP service not configured.' });
    }
    try {
      const checkRes = await fetch(
        `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          },
          body: new URLSearchParams({ To: fullPhone, Code: otp.toString().trim() }),
        }
      );
      const data = await checkRes.json();
      if (data.status === 'approved') {
        return res.status(200).json({ success: true, phoneToken: await issuePhoneToken(fullPhone) });
      }
      return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
    } catch (err) {
      console.error('[OTP] Verify check error:', err);
      return res.status(500).json({ error: 'Server error. Please try again.' });
    }
  }

  const attempts = attemptMap.get(token) || 0;
  if (attempts >= 5) {
    return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new OTP.' });
  }
  if (isTokenUsed(token)) {
    return res.status(400).json({ error: 'This OTP has already been used. Please request a new one.' });
  }
  let record;
  try { record = await readOtpToken(token); }
  catch { return res.status(401).json({ error: 'Invalid or tampered token. Please request a new OTP.' }); }
  if (record.phone !== fullPhone) return res.status(400).json({ error: 'Phone number mismatch.' });
  if (Date.now() > record.expiresAt) return res.status(400).json({ error: 'OTP has expired.' });
  if (!(await otpMatches(record, otp))) {
    attemptMap.set(token, attempts + 1);
    const left = 4 - attempts;
    return res.status(400).json({ error: `Incorrect OTP. ${left} attempt${left === 1 ? '' : 's'} remaining.` });
  }
  attemptMap.delete(token);
  usedTokens.set(token, record.expiresAt);
  return res.status(200).json({ success: true, phoneToken: await issuePhoneToken(fullPhone) });
}
