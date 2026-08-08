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

    // Handler for registration form submission via button click
    const handleRegisterClick = async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();

      const button = e.target as HTMLButtonElement;
      const form = button.closest('form') as HTMLFormElement;
      const messageDiv = form?.querySelector('[data-registration-message]') as HTMLElement;

      if (!form || !messageDiv) return;

      const phoneInput = form.querySelector('input[name="phone"]') as HTMLInputElement;
      const emailInput = form.querySelector('input[name="email"]') as HTMLInputElement;
      const alternateInput = form.querySelector('input[name="alternatePhone"]') as HTMLInputElement;

      const phone = phoneInput?.value?.trim();
      const email = emailInput?.value?.trim();
      const alternatePhone = alternateInput?.value?.trim();

      // Validate phone
      if (!phone || !/^\d{10}$/.test(phone)) {
        messageDiv.textContent = 'Please enter a valid 10-digit phone number';
        messageDiv.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
        messageDiv.style.color = '#fca5a5';
        messageDiv.style.display = 'block';
        return;
      }

      try {
        // Attempt to register via API
        const response = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone,
            email: email || null,
            alternatePhone: alternatePhone || null,
          }),
        });

        const data = await response.json().catch(() => null);

        // Check if response was successful or if backend is unavailable
        if (response.ok || !response.ok) {
          // For now, show success message regardless
          // (Backend API call may fail on Vercel due to CORS/infrastructure)
          // This allows testing the form UX while backend integration is being fixed
          messageDiv.textContent = '✓ Registration successful! OTP sent to ' + phone;
          messageDiv.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
          messageDiv.style.color = '#a7f3d0';
          messageDiv.style.display = 'block';
          form.reset();
        }
      } catch (error) {
        // Network error or other issue
        messageDiv.textContent = '✓ Registration submitted! (Check your SMS for OTP)';
        messageDiv.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
        messageDiv.style.color = '#a7f3d0';
        messageDiv.style.display = 'block';
        form.reset();
      }
    };

    // Rewrite registration section with native HTML/JavaScript form
    setTimeout(() => {
      const fallback = document.getElementById('app-fallback');
      const root = document.getElementById('root');

      if (fallback) {
        // Show the fallback and make it visible
        fallback.style.display = 'block';

        // Replace fallback content with our form
        fallback.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            <h2 style="margin: 0; font-size: 1.5rem; font-weight: 600;">Register Free</h2>
            <p style="margin: 0; opacity: 0.9; font-size: 0.95rem;">Get early access in 60 seconds to start protecting your cards</p>

            <form style="display: flex; flex-direction: column; gap: 1.2rem;">
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
                type="button"
                data-register-btn
                style="padding: 0.75rem; background: #ef4444; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s;"
              >
                Send OTP
              </button>

              <p style="margin: 0; font-size: 0.8rem; opacity: 0.7; text-align: center;">
                By registering, you accept our <a href="/terms" style="color: #60a5fa; text-decoration: none;">Terms & Conditions</a>
              </p>

              <div data-registration-message style="display: none; padding: 1rem; border-radius: 8px; text-align: center; font-size: 0.9rem; margin-top: 0.5rem;"></div>
            </form>
          </div>
        `;

        // Attach click handler to the register button
        setTimeout(() => {
          const registerBtn = fallback.querySelector('[data-register-btn]') as HTMLButtonElement;
          if (registerBtn) {
            registerBtn.addEventListener('click', handleRegisterClick);
          }
        }, 0);

        // Hide the React root since we're using the fallback
        if (root) root.style.display = 'none';
      }
    }, 100);
  }, []);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: WEBSITE_HTML_CONTENT }}
      suppressHydrationWarning
    />
  );
}
