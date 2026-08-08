import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Fetch the index.html from this deployment's static files
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const url = `${protocol}://${host}/index.html`;

    const response = await fetch(url);
    const htmlContent = await response.text();

    // Extract body content only
    const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const content = bodyMatch ? bodyMatch[1] : htmlContent;

    res.status(200).json({ content });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to load content' });
  }
}
