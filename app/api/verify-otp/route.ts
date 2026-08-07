import { NextRequest, NextResponse } from 'next/server';

const attemptMap = new Map<string, number>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone, otp } = body || {};

    if (!phone || !otp) {
      return NextResponse.json(
        { error: 'Phone and OTP are required' },
        { status: 400 }
      );
    }

    const digits = phone.replace(/\D/g, '').replace(/^91/, '');
    const fullPhone = '+91' + digits;

    // For dummy/testing mode
    const isDummyMode = process.env.OTP_MODE === 'dummy';
    if (isDummyMode) {
      const attempts = attemptMap.get(fullPhone) || 0;
      if (attempts >= 5) {
        return NextResponse.json(
          { error: 'Too many incorrect attempts. Please request a new OTP.' },
          { status: 429 }
        );
      }

      if (otp.toString().trim() === '1234') {
        attemptMap.delete(fullPhone);
        return NextResponse.json({
          success: true,
          phoneToken: `token-${fullPhone}-${Date.now()}`,
        });
      }

      attemptMap.set(fullPhone, attempts + 1);
      return NextResponse.json(
        { error: 'Incorrect OTP. Please try again.' },
        { status: 400 }
      );
    }

    // Real Twilio Verify service
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

    if (!accountSid || !authToken || !serviceSid) {
      return NextResponse.json(
        { error: 'OTP service not configured' },
        { status: 500 }
      );
    }

    try {
      const verifyRes = await fetch(
        `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          },
          body: new URLSearchParams({
            To: fullPhone,
            Code: otp.toString(),
          }),
        }
      );

      const data = await verifyRes.json();
      if (!verifyRes.ok || data.status !== 'approved') {
        return NextResponse.json(
          { error: 'Invalid OTP. Please try again.' },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        phoneToken: `verified-${fullPhone}-${Date.now()}`,
      });
    } catch (err) {
      console.error('[OTP Verify] Error:', err);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  } catch (error) {
    console.error('[Verify OTP] Handler error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}
