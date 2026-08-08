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
    const fs = require('fs');
    const path = require('path');

    // Try different path patterns
    const baseDir = process.cwd();
    const filePath = path.resolve(baseDir, 'public', 'index.html');

    // Log for debugging
    console.log('Attempting to read from:', filePath);
    console.log('Current working directory:', baseDir);
    console.log('Directory contents:', fs.readdirSync(baseDir));

    if (fs.existsSync(filePath)) {
      const fullHtml = fs.readFileSync(filePath, 'utf-8');
      const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const htmlContent = bodyMatch ? bodyMatch[1] : fullHtml;

      return {
        props: { htmlContent },
        revalidate: 3600,
      };
    } else {
      console.log('File not found at:', filePath);
      throw new Error('index.html not found');
    }
  } catch (error) {
    console.error('Build-time error:', error);
    return {
      props: {
        htmlContent: `
          <div style="padding: 2rem; font-family: sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #f1f5f9; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
            <h1 style="font-size: 2.5rem; margin-bottom: 1rem;">BlockMyCard.in</h1>
            <h2 style="font-size: 1.5rem; color: #fca5a5; margin-bottom: 1rem;">Your wallet is stolen.<br/>You have 4 minutes.</h2>
            <p style="font-size: 1.1rem; margin-bottom: 2rem; max-width: 600px;">
              Fraudsters drain accounts in under 4 minutes. BlockMyCard keeps your cards safe and lets you block them all in one tap.
            </p>
            <p style="font-size: 0.95rem; color: #cbd5e1;">✓ Free · ✓ For Indian banks · ✓ Any phone · ✓ All cards protected</p>
          </div>
        `,
      },
      revalidate: 60,
    };
  }
};
