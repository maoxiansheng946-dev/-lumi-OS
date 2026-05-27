declare global {
  interface Window {
    __LUMI_API_BRIDGE_INSTALLED__?: boolean;
  }
}

// Desktop app always talks to local backend — no environment detection needed
export function getBackendOrigin(): string {
  return 'http://127.0.0.1:3000';
}

export function getSocketOrigin(): string {
  return getBackendOrigin();
}

export function installApiBridge(): void {
  if (typeof window === 'undefined' || window.__LUMI_API_BRIDGE_INSTALLED__) return;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    // Never intercept Tauri IPC calls
    if (url.includes('ipc.localhost') || url.includes('tauri://')) {
      return nativeFetch(input, init);
    }

    // Rewrite relative API paths to local backend
    if (url.startsWith('/')) {
      const isApiPath = url.startsWith('/api/') || url === '/api' || url.startsWith('/mcp/') || url.startsWith('/lap') || url.startsWith('/socket.io');
      if (!isApiPath) {
        return nativeFetch(input, init);
      }

      const absoluteUrl = getBackendOrigin() + url;
      const patched: RequestInit = { ...init };

      try {
        const storedToken = localStorage.getItem('lumi_auth_token');
        if (storedToken) {
          patched.headers = {
            ...(patched.headers as Record<string, string> || {}),
            'Authorization': `Bearer ${storedToken}`,
          };
        }
      } catch {}

      return nativeFetch(absoluteUrl, patched);
    }

    return nativeFetch(input, init);
  };

  window.__LUMI_API_BRIDGE_INSTALLED__ = true;
}
