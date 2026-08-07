'use client';

import { useEffect, useState } from 'react';

export default function Home() {
  const [htmlContent, setHtmlContent] = useState<string>('');

  useEffect(() => {
    // Fetch the original index.html
    fetch('/index.html')
      .then(res => res.text())
      .then(html => {
        // Adjust asset paths if needed
        const adjustedHtml = html
          .replace(/href="\/assets\//g, 'href="/assets/')
          .replace(/src="\/assets\//g, 'src="/assets/');
        setHtmlContent(adjustedHtml);
      })
      .catch(err => {
        console.error('Failed to load website:', err);
        setHtmlContent(`<h1>BlockMyCard.in</h1><p>Loading website...</p>`);
      });
  }, []);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: htmlContent }}
      suppressHydrationWarning
    />
  );
}
