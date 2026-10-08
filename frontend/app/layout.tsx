import './globals.css';
export const metadata = { title: 'Executive Voice Agent', description: 'Digital executive voice agent' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

