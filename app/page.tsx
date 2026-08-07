import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';

async function getHtmlContent() {
  const paths = [
    resolve(process.cwd(), 'public', 'index.html'),
    resolve('/var/task', 'public', 'index.html'),
    resolve('.next', 'server', 'public', 'index.html'),
  ];

  for (const filePath of paths) {
    try {
      console.log(`[DEBUG] Checking path: ${filePath} (exists: ${existsSync(filePath)})`);
      if (existsSync(filePath)) {
        const content = await readFile(filePath, 'utf-8');
        console.log(`[DEBUG] Successfully read HTML from: ${filePath} (size: ${content.length})`);
        return content;
      }
    } catch (error) {
      console.error(`[DEBUG] Error reading ${filePath}:`, error);
    }
  }

  console.error('[ERROR] Could not find index.html at any path');
  return '<h1>Error: Website file not found</h1><p>Paths checked: ' + paths.join(', ') + '</p>';
}

export default async function Home() {
  const htmlContent = await getHtmlContent();
  return (
    <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
  );
}
