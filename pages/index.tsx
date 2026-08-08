import { useEffect } from 'react';
import { WEBSITE_HTML_CONTENT } from '../lib/website-html';

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
    const checkAndReplace = () => {
      const root = document.getElementById('root');
      const fallback = document.getElementById('app-fallback');

      console.log('[Registration Form Check] root:', !!root, 'fallback:', !!fallback);

      if (root) {
        console.log('[Registration Form] Found root, hasChildren:', !!root.firstChild);
        // If root exists and is empty, replace with iframe
        if (!root.firstChild) {
          console.log('[Registration Form] Replacing with iframe');
          root.innerHTML = '<iframe src="/register" style="width:100%;height:700px;border:none;border-radius:16px;background:transparent;"></iframe>';
        }
      }
    };

    setTimeout(checkAndReplace, 500);
  }, []);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: WEBSITE_HTML_CONTENT }}
      suppressHydrationWarning
    />
  );
}
