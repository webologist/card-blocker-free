import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BlockMyCard.in — A Card Blocking Helper for Indian Users',
  description: 'Free card blocking service for Indian cardholders',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
