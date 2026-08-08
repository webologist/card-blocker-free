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
    const filePath = path.join(process.cwd(), 'public', 'index.html');
    const htmlContent = fs.readFileSync(filePath, 'utf-8');

    return {
      props: {
        htmlContent,
      },
      revalidate: 3600, // Revalidate every hour
    };
  } catch (error) {
    console.error('Error reading HTML file:', error);
    return {
      props: {
        htmlContent: '<h1>Error loading content</h1>',
      },
      revalidate: 60,
    };
  }
};
