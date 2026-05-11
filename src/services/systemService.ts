/**
 * System Service Bridge
 * Abstracts communication between the React frontend and the Desktop shell (Tauri/Electron).
 */

export interface CommandResponse {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}

class SystemService {
  private isTauri: boolean;
  private isElectron: boolean;

  constructor() {
    this.isTauri = typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI_IPC__ || !!(window as any).__TAURI__);
    this.isElectron = typeof window !== 'undefined' && (!!(window as any).lumiElectron || navigator.userAgent.toLowerCase().includes('electron'));
  }

  /**
   * Execute a system command
   */
  async runCommand(command: string): Promise<CommandResponse> {
    if (this.isTauri) {
      try {
        // Tauri 'run_command' would be a custom command defined in src-tauri/src/main.rs
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke('run_command', { command });
      } catch (err) {
        return { success: false, output: '', error: String(err) };
      }
    }

    if (this.isElectron && (window as any).lumiElectron) {
      return await (window as any).lumiElectron.runCommand(command);
    }

    // Web: no shell access
    return {
      success: false,
      output: '',
      error: 'System commands require the desktop app (Tauri). Browser mode has no shell access.',
    };
  }
  /**
   * Toggle mini floating mode — shrinks window to 220x220 orb at bottom-right
   */
  async setMiniMode(enabled: boolean): Promise<boolean> {
    if (this.isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<boolean>('toggle_mini_mode', { enabled });
      } catch (err) {
        console.error('Failed to toggle mini mode:', err);
        return false;
      }
    }
    return false;
  }

  /**
   * Toggle wallpaper visual mode + OS-level click-through (Win32 WS_EX_TRANSPARENT)
   */
  async setWallpaperMode(enabled: boolean): Promise<void> {
    if (enabled) {
      document.documentElement.classList.add('lumi-wallpaper-mode');
    } else {
      document.documentElement.classList.remove('lumi-wallpaper-mode');
    }

    if (this.isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_wallpaper_mode', { enabled });
      } catch (err) {
        console.error('Failed to set wallpaper mode:', err);
      }
    }
  }

  /**
   * Get system info (CPU, RAM, etc)
   */
  async getSystemStats(): Promise<any> {
    if (this.isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke('get_system_info');
      } catch (err) {
        console.error("Failed to get system stats:", err);
        return { cpu: 0, ram: 'N/A', disk: 'N/A' };
      }
    }
    if (this.isElectron) {
      return { cpu: 'N/A', ram: 'N/A', disk: 'N/A', platform: 'electron' };
    }
    // Web: use browser APIs where available
    const nav = navigator as any;
    return {
      cpu: nav.hardwareConcurrency || 'unknown',
      ram: nav.deviceMemory ? `${nav.deviceMemory}GB` : 'unknown',
      platform: navigator.platform,
      userAgent: navigator.userAgent.slice(0, 80),
    };
  }
}

export const systemService = new SystemService();
