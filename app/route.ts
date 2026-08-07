import { readFile } from 'fs/promises';
import { join } from 'path';
import { NextResponse } from 'next/server';

let cachedHtml: string | null = null;

async function getHtmlContent(): Promise<string> {
  // Return cached version if available
  if (cachedHtml) {
    return cachedHtml;
  }

  try {
    const filePath = join(process.cwd(), 'public', 'index.html');
    cachedHtml = await readFile(filePath, 'utf-8');
    return cachedHtml;
  } catch (error) {
    console.error('Failed to load index.html:', error);
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
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
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
    h1 { color: #d63a2a; margin-bottom: 1rem; }
    .status { background: white; padding: 1.5rem; border-radius: 8px; border-left: 4px solid #d63a2a; }
    .loading { color: #666; }
  </style>
</head>
<body>
  <h1>BlockMyCard.in</h1>
  <div class="status">
    <p class="loading">🔄 Website is loading...</p>
    <p>If you see this for more than a few seconds, please refresh the page.</p>
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
