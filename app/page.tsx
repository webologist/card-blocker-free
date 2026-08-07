import { readFile } from 'fs/promises';
import { resolve } from 'path';

async function getHtmlContent() {
  try {
    const filePath = resolve(process.cwd(), 'public', 'index.html');
    return await readFile(filePath, 'utf-8');
  } catch (error) {
    console.error('Failed to read index.html:', error);
    return '<h1>Error loading website</h1>';
  }
}

export default async function Home() {
  const htmlContent = await getHtmlContent();

  return (
    <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
  );
}
