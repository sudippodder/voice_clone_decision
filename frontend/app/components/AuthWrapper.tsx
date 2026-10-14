'use client';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, ReactNode } from 'react';

export default function AuthWrapper({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const isLogged = typeof window !== 'undefined' && localStorage.getItem('isLoggedIn') === 'true';
    setLoggedIn(isLogged);
    setChecked(true);
    if (!isLogged && pathname !== '/login') {
      router.replace('/login');
    }
  }, [router, pathname]);

  if (!checked) return null;
  // If not logged in we are either on /login or already redirected, so just render children (login page will handle its UI)
  return <>{children}</>;
}
