/**
 * System microphone capture via ffmpeg.
 *
 * Captures audio from the default system microphone and emits raw PCM
 * (16-bit signed integer, 16000 Hz, mono) as Buffer chunks.
 *
 * Why ffmpeg: it handles the OS-level microphone permission prompt.
 * On macOS, the Node.js binary is signed (from nodejs.org), so ffmpeg
 * inherits its permissions and can trigger the TCC mic prompt.
 */
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../../logger';

export interface SystemMic {
  readonly platform: string;
  readonly running: boolean;
  start(): Promise<void>;
  stop(): void;
  removeAllListeners(event?: string): void;
  on(event: 'data', listener: (chunk: Buffer) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: (code: number | null) => void): this;
}

function findFfmpeg(): string {
  // In the bundled app, ffmpeg may be alongside node or in PATH
  const candidates = ['ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'];
  return candidates[0]; // rely on PATH resolution via spawn
}

function buildArgs(): { cmd: string; args: string[] } {
  const plt = process.platform;
  const commonArgs = ['-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-'];

  if (plt === 'darwin') {
    // avfoundation ":0" = default microphone
    return { cmd: findFfmpeg(), args: ['-f', 'avfoundation', '-i', ':0', ...commonArgs] };
  }
  if (plt === 'linux') {
    return { cmd: findFfmpeg(), args: ['-f', 'alsa', '-i', 'default', ...commonArgs] };
  }
  if (plt === 'win32') {
    // dshow on Windows — fallback (WebView2 already works on Windows, this is for completeness)
    return { cmd: findFfmpeg(), args: ['-f', 'dshow', '-i', 'audio=default', ...commonArgs] };
  }
  throw new Error(`Unsupported platform for system mic: ${plt}`);
}

export function createSystemMic(): SystemMic {
  let proc: ChildProcess | null = null;
  const emitter = new EventEmitter();

  const mic: SystemMic = {
    get platform() { return process.platform; },
    get running() { return proc !== null && !proc.killed; },

    async start() {
      if (proc && !proc.killed) return;

      const { cmd, args } = buildArgs();
      logger.info(`[SystemMic] Starting: ${cmd} ${args.join(' ')}`);

      proc = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';

      proc.on('error', (err) => {
        logger.error(`[SystemMic] Process error: ${err.message}`);
        emitter.emit('error', err);
      });

      if (proc.stderr) {
        proc.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
      }

      if (proc.stdout) {
        proc.stdout.on('data', (chunk: Buffer) => {
          emitter.emit('data', chunk);
        });
      }

      proc.on('close', (code) => {
        logger.info(`[SystemMic] Process closed (code=${code})${stderr ? ' stderr: ' + stderr.slice(0, 200) : ''}`);
        proc = null;
        emitter.emit('close', code);
      });
    },

    stop() {
      if (proc && !proc.killed) {
        logger.info('[SystemMic] Stopping');
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (proc && !proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 2000);
      }
      proc = null;
    },

    on(event, listener) {
      emitter.on(event, listener);
      return mic;
    },

    removeAllListeners(event) {
      emitter.removeAllListeners(event);
    },
  };

  return mic;
}
