import { readFileSync } from 'fs';
import { resolve } from 'path';
import { NextResponse } from 'next/server';

let htmlCache: string | null = null;

function getIndexHtml(): string {
  if (htmlCache) return htmlCache;

  try {
    // Try to read from the project root's public folder
    const filePath = resolve(process.cwd(), 'public', 'index.html');
    console.log(`[route] Reading from: ${filePath}`);
    htmlCache = readFileSync(filePath, 'utf-8');
    console.log(`[route] Loaded ${htmlCache.length} bytes`);
    return htmlCache;
  } catch (err) {
    console.error(`[route] Error reading file:`, err);
    throw err;
  }
}

export async function GET() {
  try {
    const html = getIndexHtml();
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60, s-maxage=3600',
      },
    });
  } catch (err) {
    console.error('[GET route] Error:', err);
    // Return a simple fallback
    return new NextResponse(
      '<!DOCTYPE html><html><head><title>BlockMyCard.in</title><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><h1>BlockMyCard.in</h1><p>Loading...</p></body></html>',
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }
}
