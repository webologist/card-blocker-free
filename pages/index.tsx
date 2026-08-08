import { useEffect } from 'react';
import { WEBSITE_HTML_CONTENT } from '../lib/website-html';
import Register from './register';

export default function Home() {
  useEffect(() => {
    // Extract style tags from the embedded HTML
    const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let match;
    const styles = [];

    while ((match = styleRegex.exec(WEBSITE_HTML_CONTENT)) !== null) {
      styles.push(match[1]);
    }

    // Inject styles into document head
    styles.forEach(styleContent => {
      const styleEl = document.createElement('style');
      styleEl.textContent = styleContent;
      document.head.appendChild(styleEl);
    });

    // Hide the broken app fallback
    setTimeout(() => {
      const fallback = document.getElementById('app-fallback');
      if (fallback) {
        fallback.parentElement?.style.setProperty('display', 'none', 'important');
      }
    }, 300);
  }, []);

  return (
    <div>
      <div
        dangerouslySetInnerHTML={{ __html: WEBSITE_HTML_CONTENT }}
        suppressHydrationWarning
      />
      {/* Render registration form as fallback */}
      <div style={{ padding: '2rem 1rem', backgroundColor: '#0f172a', minHeight: '400px' }}>
        <Register />
      </div>
    </div>
  );
}
