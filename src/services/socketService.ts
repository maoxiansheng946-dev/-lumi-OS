import { io, Socket } from "socket.io-client";
import { getSocketOrigin } from "./apiBridge";
import { getStoredToken } from "./authService";

function getDeviceFingerprint(): string {
  const key = 'lumi_device_fingerprint';
  let fp: string | null = null;
  try { fp = localStorage.getItem(key); } catch {}
  if (!fp) {
    fp = `${navigator.platform || 'unknown'}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    try { localStorage.setItem(key, fp); } catch {}
  }
  return fp;
}

const DEVICE_FINGERPRINT = getDeviceFingerprint();

const HEARTBEAT_KEY = 'lumi_page_heartbeat';
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let disconnectSince: number | null = null;
const DISCONNECT_RELOAD_MS = 120_000; // 2 minutes disconnected → reload
const HEARTBEAT_INTERVAL_MS = 5_000;

function startWatchdog(socket: Socket) {
  // Heartbeat to localStorage — survives page crashes and lets us detect recovery
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      try { localStorage.setItem(HEARTBEAT_KEY, String(Date.now())); } catch {}
    }, HEARTBEAT_INTERVAL_MS);
  }

  socket.on("connect", () => {
    disconnectSince = null;
  });

  socket.on("disconnect", () => {
    if (disconnectSince === null) disconnectSince = Date.now();
  });

  // Periodic check: if disconnected for too long, reload to restore the WebView2 renderer
  const checkInterval = setInterval(() => {
    if (disconnectSince && (Date.now() - disconnectSince) > DISCONNECT_RELOAD_MS) {
      console.warn('[Watchdog] Socket disconnected for >2min, reloading page to recover renderer');
      clearInterval(checkInterval);
      window.location.reload();
    }
    // Also ping the server directly as a secondary health check
    const token = getStoredToken();
    if (token) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => {
        // If fetch fails AND socket is disconnected, reload sooner
        if (disconnectSince && (Date.now() - disconnectSince) > 60_000) {
          console.warn('[Watchdog] Server unreachable + socket disconnected >1min, reloading');
          clearInterval(checkInterval);
          window.location.reload();
        }
      });
    }
  }, 30_000);

  // Visibility: when the user returns to the tab, check if we're still connected
  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      if (!socket.connected && disconnectSince && (Date.now() - disconnectSince) > 30_000) {
        console.warn('[Watchdog] Page became visible but socket disconnected >30s, reconnecting');
        socket.connect();
      }
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  // Return cleanup
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(checkInterval);
  };
}

class SocketService {
  private socket: Socket | null = null;
  private token: string | null = null;
  private watchdogCleanup: (() => void) | null = null;

  connect() {
    const token = getStoredToken();

    if (!this.socket) {
      this.token = token;
      this.socket = io(getSocketOrigin(), {
        withCredentials: true,
        auth: { token, fingerprint: DEVICE_FINGERPRINT },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
      });

      this.socket.on("connect", () => {
        console.log("[SocketService] Connected, id:", this.socket?.id);
      });

      this.socket.on("disconnect", (reason) => {
        console.log("[SocketService] Disconnected:", reason);
      });

      this.socket.on("connect_error", (err) => {
        console.error("[SocketService] Connect error:", err.message);
      });

      this.watchdogCleanup = startWatchdog(this.socket);
    } else if (token !== this.token) {
      this.token = token;
      this.socket.auth = { token, fingerprint: DEVICE_FINGERPRINT };
      this.socket.disconnect().connect();
    }
    return this.socket;
  }

  refreshAuth() {
    const token = getStoredToken();
    this.token = token;
    if (!this.socket) return null;
    this.socket.auth = { token, fingerprint: DEVICE_FINGERPRINT };
    if (this.socket.connected) {
      this.socket.disconnect().connect();
    } else {
      this.socket.connect();
    }
    return this.socket;
  }

  getSocket() {
    return this.socket;
  }

  disconnect() {
    if (this.watchdogCleanup) {
      this.watchdogCleanup();
      this.watchdogCleanup = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.token = null;
    }
  }
}

export const socketService = new SocketService();
