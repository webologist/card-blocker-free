export const metadata = {
  title: "BlockMyCard.in",
  description: "Card blocking helper for Indian users",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
