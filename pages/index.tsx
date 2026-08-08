import { GetStaticProps } from 'next';
import fs from 'fs';
import path from 'path';

interface HomeProps {
  htmlContent: string;
}

export default function Home({ htmlContent }: HomeProps) {
  return (
    <div
      dangerouslySetInnerHTML={{ __html: htmlContent }}
      suppressHydrationWarning
    />
  );
}

export const getStaticProps: GetStaticProps<HomeProps> = async () => {
  try {
    // Try multiple possible paths for public/index.html
    const possiblePaths = [
      path.join(process.cwd(), 'public', 'index.html'),
      path.join(__dirname, '..', 'public', 'index.html'),
      '/public/index.html',
      'public/index.html',
    ];

    let fullHtml = '';
    for (const filePath of possiblePaths) {
      try {
        fullHtml = fs.readFileSync(filePath, 'utf-8');
        break;
      } catch (e) {
        // Continue to next path
      }
    }

    if (!fullHtml) {
      throw new Error('Could not find index.html in any expected location');
    }

    // Extract body content only (remove html, head, body tags)
    const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const htmlContent = bodyMatch ? bodyMatch[1] : fullHtml;

    return {
      props: {
        htmlContent,
      },
      revalidate: 3600,
    };
  } catch (error) {
    console.error('Error reading HTML file:', error);
    return {
      props: {
        htmlContent: '<h1>BlockMyCard.in</h1><p>Error loading content: ' + String(error) + '</p>',
      },
      revalidate: 60,
    };
  }
};
