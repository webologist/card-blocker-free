import { useEffect } from 'react';
import { WEBSITE_HTML_CONTENT } from '../lib/website-html';

export default function Home() {
  useEffect(() => {
    // Extract and inject styles from embedded HTML
    const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let match;
    const styles = [];

    while ((match = styleRegex.exec(WEBSITE_HTML_CONTENT)) !== null) {
      styles.push(match[1]);
    }

    styles.forEach(styleContent => {
      const styleEl = document.createElement('style');
      styleEl.textContent = styleContent;
      document.head.appendChild(styleEl);
    });

    // Rewrite registration section with native HTML/JavaScript form
    setTimeout(() => {
      const fallback = document.getElementById('app-fallback');
      const root = document.getElementById('root');

      if (fallback) {
        // Show the fallback and make it visible
        fallback.style.display = 'block';

        // Replace fallback content with our form using inline handler
        fallback.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            <h2 style="margin: 0; font-size: 1.5rem; font-weight: 600;">Register Free</h2>
            <p style="margin: 0; opacity: 0.9; font-size: 0.95rem;">Get early access in 60 seconds to start protecting your cards</p>

            <form onsubmit="return window.handleRegistration(event)" style="display: flex; flex-direction: column; gap: 1.2rem;">
              <div>
                <label style="display: block; margin-bottom: 0.5rem; font-size: 0.9rem; font-weight: 500;">Mobile Number *</label>
                <input
                  type="tel"
                  name="phone"
                  placeholder="10-digit number"
                  maxlength="10"
                  required
                  style="width: 100%; padding: 0.75rem; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(255,255,255,0.1); color: #fff; font-size: 1rem; box-sizing: border-box;"
                />
              </div>

              <div>
                <label style="display: block; margin-bottom: 0.5rem; font-size: 0.9rem; font-weight: 500;">Email</label>
                <input
                  type="email"
                  name="email"
                  placeholder="your@email.com"
                  style="width: 100%; padding: 0.75rem; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(255,255,255,0.1); color: #fff; font-size: 1rem; box-sizing: border-box;"
                />
              </div>

              <div>
                <label style="display: block; margin-bottom: 0.5rem; font-size: 0.9rem; font-weight: 500;">Alternate Contact (Optional)</label>
                <input
                  type="tel"
                  name="alternatePhone"
                  placeholder="Family member's number"
                  style="width: 100%; padding: 0.75rem; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(255,255,255,0.1); color: #fff; font-size: 1rem; box-sizing: border-box;"
                />
              </div>

              <button
                type="submit"
                style="padding: 0.75rem; background: #ef4444; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s;"
              >
                Send OTP
              </button>

              <p style="margin: 0; font-size: 0.8rem; opacity: 0.7; text-align: center;">
                By registering, you accept our <a href="/terms" style="color: #60a5fa; text-decoration: none;">Terms & Conditions</a>
              </p>

              <div id="registration-message" style="display: none; padding: 1rem; border-radius: 8px; text-align: center; font-size: 0.9rem; margin-top: 0.5rem;"></div>
            </form>
          </div>
        `;

        // Hide the React root since we're using the fallback
        if (root) root.style.display = 'none';
      }
    }, 100);

    // Define the global form handler
    (window as any).handleRegistration = async (e: Event) => {
      e.preventDefault();

      const form = (e.target as HTMLFormElement);
      const messageDiv = form.querySelector('#registration-message') as HTMLElement;

      if (!messageDiv) return false;

      const formData = new FormData(form);
      const phone = (formData.get('phone') as string)?.trim();
      const email = (formData.get('email') as string)?.trim();
      const alternatePhone = (formData.get('alternatePhone') as string)?.trim();

      // Validate phone
      if (!phone || !/^\d{10}$/.test(phone)) {
        messageDiv.textContent = 'Please enter a valid 10-digit phone number';
        messageDiv.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
        messageDiv.style.color = '#fca5a5';
        messageDiv.style.display = 'block';
        return false;
      }

      try {
        const response = await fetch('/api/storage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: `cbp:user:${phone}`,
            value: JSON.stringify({
              phone,
              email: email || null,
              alternatePhone: alternatePhone || null,
              registeredAt: new Date().toISOString(),
            }),
          }),
        });

        if (response.ok) {
          messageDiv.textContent = '✓ Registration successful! Check your email for OTP.';
          messageDiv.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
          messageDiv.style.color = '#a7f3d0';
          messageDiv.style.display = 'block';
          form.reset();
        } else {
          throw new Error('Registration failed');
        }
      } catch (error) {
        messageDiv.textContent = 'Error during registration. Please try again.';
        messageDiv.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
        messageDiv.style.color = '#fca5a5';
        messageDiv.style.display = 'block';
      }

      return false;
    };
  }, []);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: WEBSITE_HTML_CONTENT }}
      suppressHydrationWarning
    />
  );
}
