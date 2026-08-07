import { readFileSync } from 'fs';
import { resolve } from 'path';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const filePath = resolve(process.cwd(), 'public', 'index.html');
    console.log(`[DEBUG] Attempting to read: ${filePath}`);

    const htmlContent = readFileSync(filePath, 'utf-8');
    console.log(`[DEBUG] Successfully read index.html (${htmlContent.length} bytes)`);

    return new NextResponse(htmlContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60, s-maxage=3600',
      },
    });
  } catch (error) {
    console.error('[ERROR] Failed to read index.html:', error);
    return new NextResponse(
      `<!DOCTYPE html>
<html>
<head>
  <title>BlockMyCard.in - Error</title>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 2rem; background: #f5f5f5; color: #333; }
    h1 { color: #d63a2a; }
    .error { background: white; padding: 2rem; border-radius: 8px; border-left: 4px solid #d63a2a; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>BlockMyCard.in</h1>
  <div class="error">
    <p><strong>Error loading website:</strong> The website file could not be found on the server.</p>
    <p><code>Error: ${error instanceof Error ? error.message : String(error)}</code></p>
    <p><a href="/">← Try refreshing the page</a></p>
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
