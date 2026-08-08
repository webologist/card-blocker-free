import { GetServerSideProps } from 'next';

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

export const getServerSideProps: GetServerSideProps<HomeProps> = async (context) => {
  try {
    const fs = require('fs');
    const path = require('path');

    const filePath = path.join(process.cwd(), 'public', 'index.html');

    if (fs.existsSync(filePath)) {
      const fullHtml = fs.readFileSync(filePath, 'utf-8');
      const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const htmlContent = bodyMatch ? bodyMatch[1] : fullHtml;

      return {
        props: {
          htmlContent,
        },
      };
    } else {
      throw new Error('File not found');
    }
  } catch (error) {
    console.error('Error loading content:', error);
    return {
      props: {
        htmlContent: `
          <div style="padding: 3rem 2rem; font-family: system-ui, -apple-system, sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #f1f5f9; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
            <div style="max-width: 600px;">
              <h1 style="font-size: 3rem; margin-bottom: 1rem; font-weight: 900;">BlockMyCard.in</h1>
              <h2 style="font-size: 1.8rem; color: #fca5a5; margin-bottom: 1.5rem; font-weight: 700;">Your wallet is stolen.<br/>You have 4 minutes.</h2>
              <p style="font-size: 1.1rem; line-height: 1.6; margin-bottom: 2rem; color: #cbd5e1;">
                Fraudsters drain accounts in under 4 minutes. Store your card numbers here to block them fast.
              </p>
              <button style="background: #d63a2a; color: white; padding: 1rem 2rem; border: none; border-radius: 8px; font-size: 1.1rem; font-weight: 700; cursor: pointer; margin-bottom: 2rem;">
                Register Free
              </button>
              <p style="font-size: 1rem; margin-top: 1rem;">
                ✓ Free · ✓ For Indian banks · ✓ Any phone · ✓ All cards protected
              </p>
            </div>
          </div>
        `,
      },
    };
  }
};
