import { readFileSync } from 'fs';
import path from 'path';

export default function Home() {
  let htmlContent: string;

  try {
    const filePath = path.join(process.cwd(), 'public', 'index.html');
    htmlContent = readFileSync(filePath, 'utf-8');
  } catch (error) {
    htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>BlockMyCard.in</title>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
      </head>
      <body style="font-family: sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto;">
        <h1>BlockMyCard.in — A Card Blocking Helper for Indian Users</h1>
        <p>A free card-blocking helper for Indian users. Store card numbers and bank helplines so you can act fast if your wallet or phone is lost.</p>
        <div style="background: #f0f0f0; padding: 1rem; border-radius: 8px; margin-top: 2rem;">
          <p><strong>Deployed to Vercel successfully!</strong></p>
          <p>🎯 GitHub: webologist/card-blocker-free</p>
          <p>🗄️ Database: Supabase (card-blocker-free)</p>
          <p>🌐 URL: https://card-blocker-free.vercel.app</p>
        </div>
      </body>
      </html>
    `;
  }

  return (
    <div dangerouslySetInnerHTML={{ __html: htmlContent }} style={{ width: '100%' }} />
  );
}
