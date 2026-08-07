import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BlockMyCard.in — A Card Blocking Helper for Indian Users',
  description: 'A free card-blocking helper for Indian users. Store card numbers and bank helplines so you can act fast if your wallet or phone is lost.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>;
}
