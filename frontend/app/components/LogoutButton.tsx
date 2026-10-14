'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function LogoutButton() {
  // No need for router navigation – we'll force a reload to guarantee a clean state
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setLoggedIn(localStorage.getItem('isLoggedIn') === 'true');
    }
  }, []);

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('isLoggedIn');
      // Reload the page to reset the app state
      window.location.href = '/';
    }
  };

  if (!loggedIn) return null;

  return (
    <button onClick={handleLogout} className="logout-button btn">
      Log Out
    </button>
  );
}
