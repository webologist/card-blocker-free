import { NextRequest, NextResponse } from 'next/server';

const rateLimitMap = new Map<string, number[]>();

function isRateLimited(phone: string): boolean {
  const now = Date.now();
  const window = 10 * 60 * 1000;
  const max = 3;
  const hits = (rateLimitMap.get(phone) || []).filter(t => now - t < window);
  if (hits.length >= max) return true;
  hits.push(now);
  rateLimitMap.set(phone, hits);
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone } = body || {};

    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    const digits = phone.replace(/\D/g, '').replace(/^91/, '');
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return NextResponse.json(
        { error: 'Invalid phone number. Enter a 10-digit Indian mobile number starting with 6-9.' },
        { status: 400 }
      );
    }

    if (isRateLimited(digits)) {
      return NextResponse.json(
        { error: 'Too many OTP requests. Please wait 10 minutes.' },
        { status: 429 }
      );
    }

    const fullPhone = '+91' + digits;

    // Dummy mode - for testing
    const isDummyMode = process.env.OTP_MODE === 'dummy';
    if (isDummyMode) {
      console.log(`[OTP] DUMMY MODE phone=${fullPhone}`);
      return NextResponse.json({
        success: true,
        token: `dummy-${Date.now()}`,
        otp: '1234',
        _dummy: true,
      });
    }

    // Real Twilio integration
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken) {
      return NextResponse.json(
        { error: 'OTP service not configured. Contact support.' },
        { status: 500 }
      );
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Send SMS via Twilio
    if (fromPhone) {
      try {
        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
            },
            body: new URLSearchParams({
              To: fullPhone,
              From: fromPhone,
              Body: `Your BlockMyCard OTP is ${otp}. Valid for 5 minutes. Do not share.`,
            }),
          }
        );

        const data = await twilioRes.json();
        if (!twilioRes.ok) {
          console.error('[OTP] Twilio error:', JSON.stringify(data));
          return NextResponse.json(
            { error: 'Failed to send OTP. Please try again.' },
            { status: 500 }
          );
        }

        return NextResponse.json({
          success: true,
          token: `otp-${fullPhone}-${Date.now()}`,
          otp,
        });
      } catch (err) {
        console.error('[OTP] Error:', err);
        return NextResponse.json({ error: 'Server error. Please try again.' }, { status: 500 });
      }
    }

    return NextResponse.json(
      { error: 'OTP service not configured. Contact support.' },
      { status: 500 }
    );
  } catch (error) {
    console.error('[OTP] Handler error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}
