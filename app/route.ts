import { NextResponse } from 'next/server';

// Fallback HTML - will be replaced at build time or use readFile as backup
let cachedHtml: string | null = null;

async function getHtmlContent(): Promise<string> {
  if (cachedHtml) return cachedHtml;

  try {
    // Try multiple paths and methods
    const paths = [
      `${process.cwd()}/public/index.html`,
      '/var/task/public/index.html',
      './.next/public/index.html',
    ];

    // Try to load from fs first
    for (const path of paths) {
      try {
        const { readFileSync } = await import('fs');
        const content = readFileSync(path, 'utf-8');
        console.log(`[SUCCESS] Loaded index.html from ${path}`);
        cachedHtml = content;
        return cachedHtml;
      } catch (e) {
        console.log(`[DEBUG] Path ${path} not found`);
      }
    }

    // If fs fails, try fetch from public URL
    try {
      const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      console.log(`[DEBUG] Attempting to fetch from ${host}/index.html`);
      const response = await fetch(`${host}/index.html`);
      if (response.ok) {
        cachedHtml = await response.text();
        console.log(`[SUCCESS] Fetched index.html from ${host}`);
        return cachedHtml;
      }
    } catch (e) {
      console.log(`[DEBUG] Fetch failed: ${e}`);
    }

    throw new Error('Could not load index.html from any source');
  } catch (error) {
    console.error('[ERROR]', error);
    throw error;
  }
}

export async function GET() {
  try {
    const htmlContent = await getHtmlContent();
    return new NextResponse(htmlContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60, s-maxage=3600',
      },
    });
  } catch (error) {
    console.error('[GET /] Error:', error);
    return new NextResponse(
      `<!DOCTYPE html>
<html>
<head>
  <title>BlockMyCard.in</title>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>
    body { font-family: system-ui; padding: 2rem; background: #f5f5f5; }
    h1 { color: #d63a2a; }
    .error { background: white; padding: 2rem; border-radius: 8px; border-left: 4px solid #d63a2a; }
  </style>
</head>
<body>
  <h1>BlockMyCard.in</h1>
  <div class="error">
    <p>🔄 Loading website...</p>
  </div>
</body>
</html>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      }
    );
  }
}
