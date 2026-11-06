/**
 * Dynamic API and WebSocket URL resolution for Executive Voice Agent.
 * Automatically adapts between local development (localhost:8000) and
 * remote server environments (e.g. 192.168.250.99:3855).
 */

export function getApiUrl(): string {
  // Priority 1: Explicit build-time or runtime environment variable (if not the default placeholder)
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl && !envUrl.includes('localhost:8000')) {
    return envUrl.replace(/\/+$/, '');
  }

  // Priority 2: In-browser automatic host detection
  if (typeof window !== 'undefined' && window.location) {
    const { hostname, protocol, port } = window.location;

    // Check localStorage override if user configured one
    try {
      const stored = localStorage.getItem('EXECUTIVE_API_URL');
      if (stored) return stored.replace(/\/+$/, '');
    } catch {
      // ignore localStorage errors
    }

    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      // If accessing via Next.js port 3000 on a server, connect to backend port 3855
      if (port === '3000') {
        return `${protocol}//${hostname}:3855`;
      }
      // If accessing via standard reverse proxy (port 80/443) or another port, use same host
      return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
    }
  }

  // Priority 3: Fallback for local development
  return (envUrl || 'http://localhost:8000').replace(/\/+$/, '');
}

export function getWsUrl(): string {
  const httpUrl = getApiUrl();
  return httpUrl.replace(/^http/, 'ws');
}

export function getAdminKey(): string {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('EXECUTIVE_ADMIN_KEY');
      if (stored) return stored;
    } catch {
      // ignore
    }
  }
  return process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'change-this-admin-key';
}
