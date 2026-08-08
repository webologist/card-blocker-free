import { useState } from 'react';

export default function Register() {
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: `cbp:user:${phone}`,
          value: JSON.stringify({
            phone,
            email,
            alternatePhone,
            registeredAt: new Date().toISOString(),
          }),
        }),
      });

      if (response.ok) {
        setMessage('✓ Registration successful! Check your email for confirmation.');
        setPhone('');
        setEmail('');
        setAlternatePhone('');
      } else {
        setMessage('Failed to register. Please try again.');
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

      <form onSubmit={handleSubmit}>
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
          {loading ? 'Registering...' : 'Send OTP'}
        </button>
      </form>

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
