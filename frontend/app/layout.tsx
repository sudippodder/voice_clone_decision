import './globals.css';
import { AuthGuard } from '../components/AuthGuard';

export const metadata = {
  title: 'Executive Voice Agent',
  description: 'Digital executive voice agent system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthGuard>{children}</AuthGuard>
      </body>
    </html>
  );
}

