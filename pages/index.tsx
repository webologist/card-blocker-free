import { GetStaticProps } from 'next';

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
    // Try to fetch content from the static index.html file
    // At build time, we can read from the filesystem directly
    const fs = require('fs');
    const path = require('path');

    const filePath = path.join(process.cwd(), 'public', 'index.html');
    const fullHtml = fs.readFileSync(filePath, 'utf-8');

    // Extract body content
    const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const htmlContent = bodyMatch ? bodyMatch[1] : fullHtml;

    return {
      props: { htmlContent },
      revalidate: 3600,
    };
  } catch (error) {
    console.error('Build-time error:', error);
    // Fallback for when file reading fails
    return {
      props: {
        htmlContent: `
          <div style="padding: 2rem; font-family: sans-serif;">
            <h1>BlockMyCard.in</h1>
            <p>Your wallet is stolen. You have 4 minutes.</p>
            <p style="color: #666; font-size: 0.9rem;">
              Free card blocking helper for Indian users.
            </p>
          </div>
        `,
      },
      revalidate: 60,
    };
  }
};
