'use client';
import { useState } from 'react';

import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simple client‑side authentication (DO NOT use in production!)
    if (username === 'admin' && password === 'pass123') {
      // Store a flag in localStorage – you can replace this with a real auth token.
      if (typeof window !== 'undefined') {
        localStorage.setItem('isLoggedIn', 'true');
      }
      router.replace('/'); // go to the home page after login
    } else {
      setError('Invalid credentials. Please try again.');
    }
  };

  return (
    <div className="login-background">
      <div className="login-card">
        <h1 className="login-title">Executive Voice Agent</h1>
        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="login-input"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="login-input"
            required
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="login-button">
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

// Styles are defined in globals.css – keep the component lightweight.
