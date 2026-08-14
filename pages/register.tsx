import { useState, useEffect } from 'react';

// This page used to "register" by POSTing straight to /api/storage under a
// key (cbp:user:<phone>) that nothing else in the app reads, with no OTP step
// at all - the "Send OTP" button never sent one, and "Check your email for
// confirmation" was shown regardless of whether any email was ever entered.
// It now goes through the same two real endpoints the main app uses
// (/api/send-otp, /api/verify-otp), so the phone number is actually proven
// before anything is saved under it.
export default function Register() {
  useEffect(() => {
    // Make iframe responsive
    if (window.parent !== window) {
      // We're in an iframe
      window.parent.postMessage({ type: 'iframe-ready' }, '*');
    }
  }, []);

  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const fullPhone = () => '+91' + phone;

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone() }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data && data.token) {
        setOtpToken(data.token);
        setStep('otp');
        setMessage(data.message || 'OTP sent. Enter it below to continue.');
      } else {
        setMessage((data && data.error) || 'Could not send OTP. Please try again.');
      }
    } catch (error) {
      setMessage('Error sending OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const verifyRes = await fetch('/api/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone(), otp, token: otpToken }),
      });
      const verifyData = await verifyRes.json().catch(() => null);
      if (!verifyRes.ok || !verifyData || !verifyData.success) {
        setMessage((verifyData && verifyData.error) || 'Invalid OTP. Please try again.');
        setLoading(false);
        return;
      }

      // Only now - with a phone token the server itself just issued, proving
      // this number was actually verified - do we save anything against it.
      const saveRes = await fetch('/api/storage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-phone-token': verifyData.phoneToken || '',
        },
        body: JSON.stringify({
          key: 'cbp:users',
          value: JSON.stringify({
            [fullPhone()]: {
              phone: fullPhone(),
              email,
              altPhone: alternatePhone ? '+91' + alternatePhone.replace(/\D/g, '').slice(-10) : '',
              altVerified: false,
              registeredAt: new Date().toISOString(),
              cards: [],
            },
          }),
        }),
      });

      if (saveRes.ok) {
        setMessage('✓ Registration successful! You can now sign in with this number.');
        setStep('phone');
        setPhone('');
        setEmail('');
        setAlternatePhone('');
        setOtp('');
        setOtpToken('');
      } else {
        const saveData = await saveRes.json().catch(() => null);
        setMessage((saveData && saveData.error) || 'Verified, but saving your details failed. Please try again.');
      }
    } catch (error) {
      setMessage('Error during registration. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      backgroundColor: '#1a1a2e',
      color: '#fff',
      borderRadius: '16px',
      padding: '2rem',
      textAlign: 'center',
      maxWidth: '500px',
      margin: '0 auto'
    }}>
      <h2 style={{ marginBottom: '1rem' }}>Register Free</h2>
      <p style={{ fontSize: '0.9rem', marginBottom: '1.5rem', opacity: 0.9 }}>
        Get 60 seconds to register and start protecting your cards
      </p>

      {step === 'phone' && (
        <form onSubmit={handleSendOtp}>
          <div style={{ marginBottom: '1rem', textAlign: 'left' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
              Mobile Number *
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit number"
              required
              style={{
                width: '100%',
                padding: '0.75rem',
                border: 'none',
                borderRadius: '8px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: '#fff',
                fontSize: '1rem',
              }}
            />
          </div>

          <div style={{ marginBottom: '1rem', textAlign: 'left' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              style={{
                width: '100%',
                padding: '0.75rem',
                border: 'none',
                borderRadius: '8px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: '#fff',
                fontSize: '1rem',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
              Alternate Contact
            </label>
            <input
              type="tel"
              value={alternatePhone}
              onChange={(e) => setAlternatePhone(e.target.value)}
              placeholder="Family member's number"
              style={{
                width: '100%',
                padding: '0.75rem',
                border: 'none',
                borderRadius: '8px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: '#fff',
                fontSize: '1rem',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading || phone.length !== 10}
            style={{
              width: '100%',
              padding: '0.75rem',
              backgroundColor: loading ? '#666' : '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Sending OTP...' : 'Send OTP'}
          </button>
        </form>
      )}

      {step === 'otp' && (
        <form onSubmit={handleVerifyAndRegister}>
          <p style={{ fontSize: '0.85rem', marginBottom: '1rem', opacity: 0.85 }}>
            Enter the OTP sent to +91 {phone}
          </p>
          <div style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
              OTP *
            </label>
            <input
              type="tel"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Enter OTP"
              required
              style={{
                width: '100%',
                padding: '0.75rem',
                border: 'none',
                borderRadius: '8px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: '#fff',
                fontSize: '1rem',
                letterSpacing: '0.2em',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading || otp.length < 4}
            style={{
              width: '100%',
              padding: '0.75rem',
              backgroundColor: loading ? '#666' : '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              marginBottom: '0.75rem',
            }}
          >
            {loading ? 'Verifying...' : 'Verify & Register'}
          </button>

          <button
            type="button"
            onClick={() => { setStep('phone'); setOtp(''); setMessage(''); }}
            style={{
              width: '100%',
              padding: '0.6rem',
              backgroundColor: 'transparent',
              color: '#cbd5e1',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '8px',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            Go back
          </button>
        </form>
      )}

      {message && (
        <p style={{
          marginTop: '1rem',
          fontSize: '0.9rem',
          color: message.includes('✓') ? '#10b981' : '#ef4444',
        }}>
          {message}
        </p>
      )}

      <p style={{ marginTop: '1rem', fontSize: '0.8rem', opacity: 0.7 }}>
        By registering, you accept our{' '}
        <a href="/terms" style={{ color: '#60a5fa', textDecoration: 'none' }}>
          Terms & Conditions
        </a>
      </p>
    </div>
  );
}
