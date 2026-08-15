import { WEBSITE_HTML_CONTENT } from '../lib/website-html';

// Serves the exact same app shell as pages/index.tsx. There is no separate
// admin bundle - app.js itself checks window.location.pathname
// (/^\/admin(\/|$)/) at runtime and renders the admin console instead of the
// customer landing page when it detects it's running under /admin. Without
// this file, Next.js's file-based router has no route for /admin and returns
// its own 404 before app.js ever gets a chance to run that check - the admin
// console was unreachable in production for this reason alone, independent
// of login/auth.
export default function Admin() {
  return (
    <div
      dangerouslySetInnerHTML={{ __html: WEBSITE_HTML_CONTENT }}
      suppressHydrationWarning
    />
  );
}
