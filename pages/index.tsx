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

    // Wait for DOM to settle, then replace broken registration app with iframe
    setTimeout(() => {
      const root = document.getElementById('root');
      const fallback = document.getElementById('app-fallback');

      if (root) {
        console.log('[Registration Form] Found root element, hasChildren:', !!root.firstChild);
        // If root exists and is empty, or if the fallback is still visible, replace with iframe
        if (!root.firstChild || (fallback && fallback.style.display !== 'none')) {
          console.log('[Registration Form] Replacing root with iframe');
          root.innerHTML = '<iframe src="/register" style="width:100%;height:700px;border:none;border-radius:16px;background:transparent;"></iframe>';
        }
      } else {
        console.log('[Registration Form] Root element not found!');
      }

      if (fallback) {
        console.log('[Registration Form] Found fallback, display:', fallback.style.display);
      }
    }, 200);
  }, []);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: WEBSITE_HTML_CONTENT }}
      suppressHydrationWarning
    />
  );
}
