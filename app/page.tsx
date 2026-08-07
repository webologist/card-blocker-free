import { readFileSync } from 'fs';
import { join } from 'path';

export default function Home() {
  let htmlContent: string;

  try {
    const filePath = join(process.cwd(), 'public', 'index.html');
    htmlContent = readFileSync(filePath, 'utf-8');

    // Update asset paths for Vercel
    htmlContent = htmlContent
      .replace(/href="\/assets\//g, 'href="/assets/')
      .replace(/src="\/assets\//g, 'src="/assets/')
      .replace(/href="\/index.html/g, 'href="/');

  } catch (error) {
    console.error('Failed to load index.html:', error);
    htmlContent = `<!DOCTYPE html>
      <html>
      <head>
        <title>BlockMyCard.in</title>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
      </head>
      <body style="font-family: sans-serif; padding: 2rem;">
        <h1>BlockMyCard.in — A Card Blocking Helper for Indian Users</h1>
        <p>Loading...</p>
        <div style="background: #f0f0f0; padding: 1rem; border-radius: 8px; margin-top: 2rem;">
          <p><strong>Deployed to Vercel successfully!</strong></p>
          <p>API Routes: /api/send-otp, /api/verify-otp, /api/storage</p>
          <p>Database: Supabase (card-blocker-free)</p>
        </div>
      </body>
      </html>`;
  }

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { scroll-behavior: smooth; }
      `}</style>
      <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
    </>
  );
}
