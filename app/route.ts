import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const file = join(process.cwd(), 'public', 'index.html');
    const data = readFileSync(file, 'utf-8');

    return new NextResponse(data, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (e) {
    console.error('Error:', e);
    return new NextResponse(
      `<!DOCTYPE html><html><body><h1>BlockMyCard.in</h1><p>Error: ${String(e)}</p></body></html>`,
      {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }
}
