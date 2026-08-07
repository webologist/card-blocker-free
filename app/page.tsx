import { readFileSync } from 'fs';
import { join } from 'path';

export default function Home() {
  let htmlContent = '';
  try {
    htmlContent = readFileSync(join(process.cwd(), 'public/index.html'), 'utf-8');
  } catch (e) {
    htmlContent = '<h1>BlockMyCard.in</h1><p>Loading...</p>';
  }

  return (
    <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
  );
}
