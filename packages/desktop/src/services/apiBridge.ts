declare global {
  interface Window {
    __LUMI_API_BRIDGE_INSTALLED__?: boolean;
  }
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as any;
  return !!(win.__TAURI_INTERNALS__ || win.__TAURI_IPC__ || win.__TAURI__);
}

export function getBackendOrigin(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3000';
  if (isTauriRuntime()) return 'http://127.0.0.1:3000';
  return window.location.origin;
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

    // In Tauri, relative API paths must be rewritten to absolute backend URL
    // because WebView2 runs on tauri://localhost but the API is on http://127.0.0.1:3000
    if (url.startsWith('/')) {
      const isApiPath = url.startsWith('/api/') || url === '/api' || url.startsWith('/mcp/') || url.startsWith('/lap') || url.startsWith('/socket.io');
      if (!isApiPath || !isTauriRuntime()) {
        return nativeFetch(input, init);
      }

      const absoluteUrl = getBackendOrigin() + url;
      const patched: RequestInit = { ...init, credentials: 'include' };

      // WebView2 may not send httpOnly cookies — inject stored auth token as fallback
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
