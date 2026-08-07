export const metadata = {
  title: "BlockMyCard.in — A Card Blocking Helper for Indian Users",
  description: "Free card-blocking helper for Indian users. Store card numbers and bank helplines so you can act fast if your wallet or phone is lost.",
};

export default function Home() {
  return (
    <html lang="en" data-theme="light">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <style>{`
          :root { --red: #d63a2a; --bg: #ffffff; --fg: #111827; }
          [data-theme="dark"] { --bg: #0f172a; --fg: #f1f5f9; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: Inter, system-ui; background: var(--bg); color: var(--fg); line-height: 1.6; }
          .hero { padding: 4rem 1.5rem; max-width: 1200px; margin: 0 auto; }
          h1 { font-size: 3.5rem; font-weight: 900; margin-bottom: 1rem; }
          .accent { color: var(--red); }
          p { font-size: 1.1rem; max-width: 600px; margin-bottom: 2rem; color: var(--fg2, #6b7280); }
          .btn { background: var(--red); color: white; padding: 0.85rem 1.75rem; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; text-decoration: none; display: inline-block; margin-right: 1rem; }
          .btn:hover { opacity: 0.9; }
        `}</style>
      </head>
      <body>
        <main className="hero">
          <h1>Your wallet is stolen.<br /><span className="accent">You have 4 minutes.</span></h1>
          <p>Fraudsters drain the average Indian account in under 4 minutes. BlockMyCard keeps your card numbers in one place so you can block them fast.</p>
          <button className="btn">Register Free — 60 Seconds →</button>
          <p style={{ marginTop: '3rem', fontSize: '0.9rem', color: 'var(--fg2, #6b7280)' }}>
            ✓ Free · ✓ For Indian banks · ✓ Any phone · ✓ All cards protected
          </p>
          <p style={{ marginTop: '2rem', fontSize: '0.85rem' }}>
            💡 Run <code>npm run dev</code> locally for the full website with all features.
          </p>
        </main>
      </body>
    </html>
  );
}
