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

    // Inject working registration form into the #root div
    setTimeout(() => {
      const fallback = document.getElementById('app-fallback');

      // Hide the fallback message
      if (fallback) {
        fallback.parentElement?.style.setProperty('display', 'none', 'important');
      }

      // Find #root which should be a sibling or near the fallback
      let root = document.getElementById('root');
      if (!root && fallback) {
        // If root doesn't exist, try to find it near fallback
        root = fallback.parentElement?.nextElementSibling as HTMLElement;
        if (!root || root.id !== 'root') {
          root = fallback.nextElementSibling as HTMLElement;
        }
      }

      if (root && (!root.firstChild || !root.innerHTML || root.innerHTML.trim().length === 0)) {
        // Inject the registration form into empty or loading root element
        const formHTML = `
          <div style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 500px;">
            <h2 style="margin: 0; font-size: 1.5rem; font-weight: 600;">Register Free</h2>
            <p style="margin: 0; opacity: 0.9; font-size: 0.95rem;">Get early access in 60 seconds to start protecting your cards</p>

            <form id="registration-form" style="display: flex; flex-direction: column; gap: 1.2rem;">
              <div>
                <label style="display: block; margin-bottom: 0.5rem; font-size: 0.9rem; font-weight: 500;">Mobile Number *</label>
                <input
                  type="tel"
                  name="phone"
                  placeholder="10-digit number"
                  maxlength="10"
                  pattern="[0-9]{10}"
                  required
                  style="width: 100%; padding: 0.75rem; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(255,255,255,0.1); color: #fff; font-size: 1rem;"
                />
              </div>

              <div>
                <label style="display: block; margin-bottom: 0.5rem; font-size: 0.9rem; font-weight: 500;">Email</label>
                <input
                  type="email"
                  name="email"
                  placeholder="your@email.com"
                  style="width: 100%; padding: 0.75rem; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(255,255,255,0.1); color: #fff; font-size: 1rem;"
                />
              </div>

              <div>
                <label style="display: block; margin-bottom: 0.5rem; font-size: 0.9rem; font-weight: 500;">Alternate Contact (Optional)</label>
                <input
                  type="tel"
                  name="alternatePhone"
                  placeholder="Family member's number"
                  style="width: 100%; padding: 0.75rem; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(255,255,255,0.1); color: #fff; font-size: 1rem;"
                />
              </div>

              <button
                type="submit"
                style="padding: 0.75rem; background: #ef4444; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer;"
              >
                Send OTP
              </button>

              <p style="margin: 0; font-size: 0.8rem; opacity: 0.7; text-align: center;">
                By registering, you accept our <a href="/terms" style="color: #60a5fa; text-decoration: none;">Terms & Conditions</a>
              </p>
            </form>

            <div id="form-message" style="display: none; padding: 1rem; border-radius: 8px; text-align: center; font-size: 0.9rem;"></div>
          </div>
        `;

        root.innerHTML = formHTML;

        // Handle form submission
        const form = document.getElementById('registration-form') as HTMLFormElement;
        const messageDiv = document.getElementById('form-message');

        if (form && messageDiv) {
          form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = new FormData(form);
            const phone = formData.get('phone') as string;
            const email = formData.get('email') as string;
            const alternatePhone = formData.get('alternatePhone') as string;

            if (!phone || phone.length !== 10) {
              messageDiv.textContent = 'Please enter a valid 10-digit phone number';
              messageDiv.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
              messageDiv.style.color = '#fca5a5';
              messageDiv.style.display = 'block';
              return;
            }

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
          });
        }
      }
    }, 1000);
  }, []);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: WEBSITE_HTML_CONTENT }}
      suppressHydrationWarning
    />
  );
}
