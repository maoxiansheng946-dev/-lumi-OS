import { io, Socket } from "socket.io-client";
import { getSocketOrigin } from "./apiBridge";
import { getStoredToken } from "./authService";

class SocketService {
  private socket: Socket | null = null;
  private token: string | null = null;

  connect() {
    const token = getStoredToken();

    if (!this.socket) {
      this.token = token;
      this.socket = io(getSocketOrigin(), {
        withCredentials: true,
        auth: token ? { token } : undefined,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
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
    } else if (token !== this.token) {
      this.token = token;
      this.socket.auth = token ? { token } : {};
      if (this.socket.connected) {
        this.socket.disconnect().connect();
      }
    }
    return this.socket;
  }

  getSocket() {
    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.token = null;
    }
  }
}

export const socketService = new SocketService();
