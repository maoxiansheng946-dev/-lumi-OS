import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getSocketOrigin, isTauriRuntime } from '@/services/apiBridge';
import { getStoredToken } from '@/services/authService';

const isTauri = isTauriRuntime();

async function handleDesktopExec(socket: Socket, data: {
  correlationId: string;
  name: string;
  arguments: Record<string, any>;
}) {
  const { correlationId, name, arguments: args } = data;

  if (!isTauri) {
    socket.emit(`tool:desktop_result:${correlationId}`, {
      error: 'Desktop tools are only available in the Tauri desktop app',
    });
    return;
  }

  try {
    // Dynamic import — @tauri-apps/api only exists in Tauri context
    const { invoke } = await import('@tauri-apps/api/core');
    let output: string;

    switch (name) {
      case 'desktop_system_info': {
        const info = await invoke('get_system_info');
        output = JSON.stringify(info, null, 2);
        break;
      }
      case 'desktop_list_files': {
        const dirPath: string = args.path || '';
        if (dirPath) {
          // Use run_command for arbitrary path listing
          const cmd = isTauri && navigator.platform?.includes('Win')
            ? `dir "${dirPath}" /B 2>nul`
            : `ls -la "${dirPath}" 2>/dev/null`;
          const result: { success: boolean; output: string } = await invoke('run_command', { command: cmd });
          output = result.output || 'No files found';
        } else {
          const files: Array<{ name: string; path: string; is_directory: boolean }> =
            await invoke('list_home_files');
          output = JSON.stringify(
            files.map(f => ({
              name: f.name,
              path: f.path,
              type: f.is_directory ? 'directory' : 'file',
            })),
            null,
            2
          );
        }
        break;
      }
      case 'desktop_open': {
        const target: string = args.target || '';
        if (!target.trim()) {
          socket.emit(`tool:desktop_result:${correlationId}`, { error: 'No target provided to open' });
          return;
        }
        const openResult: { success: boolean; output: string } = await invoke('open_item', { target: target.trim() });
        output = openResult.output || `Opened: ${target}`;
        break;
      }
      case 'desktop_run_command': {
        const cmd: string = args.command || '';
        if (!cmd.trim()) {
          socket.emit(`tool:desktop_result:${correlationId}`, { error: 'No command provided' });
          return;
        }
        const result: { success: boolean; output: string } = await invoke('run_command', { command: cmd });
        output = (result.success ? '' : '[FAILED] ') + result.output;
        break;
      }
      case 'desktop_active_window': {
        const info = await invoke('get_active_window_info');
        output = JSON.stringify(info, null, 2);
        break;
      }
      case 'desktop_running_processes': {
        const procs = await invoke('get_running_processes');
        output = JSON.stringify(procs, null, 2);
        break;
      }
      case 'desktop_capture_screen': {
        const capture = await invoke('capture_screen');
        output = JSON.stringify({ width: (capture as any).width, height: (capture as any).height, image_base64_preview: (capture as any).image_base64?.slice(0, 80) + '...' });
        break;
      }
      default:
        socket.emit(`tool:desktop_result:${correlationId}`, {
          error: `Unknown desktop tool: ${name}`,
        });
        return;
    }

    socket.emit(`tool:desktop_result:${correlationId}`, { output });
  } catch (err: any) {
    socket.emit(`tool:desktop_result:${correlationId}`, { error: err.message || String(err) });
  }
}

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const url = getSocketOrigin();
    const token = getStoredToken();
    const s = io(url, {
      withCredentials: true,
      auth: { token },
    });

    s.on('connect', () => {
      console.log('[Socket] Connected to', url);

      // Auto-register this device
      s.emit('device:register', {
        name: navigator.platform || 'Unknown Device',
        type: isTauri ? 'desktop' : 'web',
        capabilities: {
          audio: true, // browser generally supports audio
          video: false, // default, users enable in settings
          spatial: false,
          haptic: false,
          holographic: false,
        },
        osInfo: navigator.platform || '',
      });
    });

    s.on('tool:desktop_exec', (data) => handleDesktopExec(s, data));

    setSocket(s);

    return () => {
      s.off('tool:desktop_exec');
      s.disconnect();
    };
  }, []);

  return socket;
}
