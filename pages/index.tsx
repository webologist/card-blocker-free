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

    // Replace the broken React app with an iframe or signal
    setTimeout(() => {
      const root = document.getElementById('root');
      if (root && !root.firstChild) {
        root.innerHTML = '<iframe src="/register" style="width:100%;height:600px;border:none;border-radius:16px;"></iframe>';
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
