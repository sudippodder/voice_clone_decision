
import './globals.css';
import LogoutButton from './components/LogoutButton';
import AuthWrapper from './components/AuthWrapper';
export const metadata = { title: 'Executive Voice Agent', description: 'Digital executive voice agent' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthWrapper>
          <LogoutButton />
          {children}
        </AuthWrapper>
      </body>
    </html>
  );
}
