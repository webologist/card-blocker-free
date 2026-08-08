import { WEBSITE_HTML_CONTENT } from '../lib/website-html';

export default function Home() {
  return (
    <div
      dangerouslySetInnerHTML={{ __html: WEBSITE_HTML_CONTENT }}
      suppressHydrationWarning
    />
  );
}
