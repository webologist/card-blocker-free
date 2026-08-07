import { readFileSync } from 'fs';
import { join } from 'path';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const filePath = join(process.cwd(), 'public', 'index.html');
    const htmlContent = readFileSync(filePath, 'utf-8');

    return new NextResponse(htmlContent, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('Failed to load index.html:', error);
    return new NextResponse(
      '<!DOCTYPE html><html><body><h1>BlockMyCard.in</h1><p>Loading website...</p></body></html>',
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      }
    );
  }
}
