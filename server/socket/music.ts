/**
 * Music Socket Handler — real-time music playback events.
 * All playback, navigation, queue, like, and recommendations go through ncm-cli.
 */
import { exec } from 'child_process';
import { Socket } from 'socket.io';

interface MusicAtmosphere {
  track: { name: string; artists: string[]; album?: string; coverUrl?: string; duration?: number };
  mood: string;
  weather?: string;
  lumiReason?: string;
  audioUrl?: string;
  lyrics?: Array<{ time: number; text: string }>;
  scene?: import('../music/scene_generator').MusicScene;
}

const userPollers = new Map<string, ReturnType<typeof setInterval>>();

function ncmExec(args: string, timeout = 10000): Promise<string> {
  return new Promise((resolve) => {
    exec(`npx @music163/ncm-cli ${args} --output json`, { timeout }, (_err, stdout) => {
      resolve(stdout || '');
    });
  });
}

function tryParse(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

function socketGuard(fn: (...args: any[]) => void | Promise<void>) {
  return (...args: any[]) => {
    try {
      const ret = fn(...args);
      if (ret && typeof (ret as any).catch === 'function') {
        (ret as any).catch((e: any) => console.error('[Music] Handler error:', e.message || String(e)));
      }
    } catch (e: any) {
      console.error('[Music] Handler error:', e.message || String(e));
    }
  };
}

export function registerMusicHandlers(
  socket: Socket,
  getUserId: (s: any) => string,
  io?: any,
) {
  const uid = getUserId(socket);

  // ── Playback ──────────────────────────────────────────────────────────

  socket.on('music:play', socketGuard(async (data: { encryptedId?: string; originalId?: string; playlist?: boolean; audioUrl?: string }) => {
    try {
      if (data.audioUrl) {
        socket.emit('music:state', { playing: true, source: 'url', audioUrl: data.audioUrl });
        return;
      }
      if (data.playlist) {
        const args = [data.encryptedId ? `--encrypted-id "${data.encryptedId}"` : '', data.originalId ? `--original-id "${data.originalId}"` : ''].filter(Boolean).join(' ');
        await ncmExec(`play --playlist ${args}`, 15000);
      } else if (data.encryptedId && data.originalId) {
        await ncmExec(`play --song --encrypted-id "${data.encryptedId}" --original-id "${data.originalId}"`, 15000);
      }
      startStatePoller(socket, uid);
      socket.emit('music:state', { playing: true, source: 'netease' });
    } catch (e: any) {
      socket.emit('music:error', { message: e.message });
    }
  }));

  socket.on('music:pause', socketGuard(async () => {
    await ncmExec('pause');
    socket.emit('music:state', { playing: false });
  }));

  socket.on('music:resume', socketGuard(async () => {
    await ncmExec('resume');
    socket.emit('music:state', { playing: true });
  }));

  socket.on('music:next', socketGuard(async () => {
    await ncmExec('next');
    pollAndEmitState(socket);
  }));

  socket.on('music:prev', socketGuard(async () => {
    await ncmExec('prev');
    pollAndEmitState(socket);
  }));

  socket.on('music:seek', socketGuard(async (data: { seconds: number }) => {
    await ncmExec(`seek ${Math.max(0, data.seconds || 0)}`);
  }));

  socket.on('music:volume', socketGuard(async (data: { level: number }) => {
    const vol = Math.max(0, Math.min(100, data.level || 50));
    await ncmExec(`volume ${vol}`);
    socket.emit('music:state', { volume: vol });
  }));

  // ── Queue ─────────────────────────────────────────────────────────────

  socket.on('music:queue:list', socketGuard(async () => {
    const raw = await ncmExec('queue');
    socket.emit('music:queue', tryParse(raw) || raw.slice(0, 1000));
  }));

  socket.on('music:queue:add', socketGuard(async (data: { encryptedId: string; originalId?: string }) => {
    const args = [`--encrypted-id "${data.encryptedId}"`, data.originalId ? `--original-id "${data.originalId}"` : ''].filter(Boolean).join(' ');
    await ncmExec(`queue add ${args}`);
    socket.emit('music:queue:added', { encryptedId: data.encryptedId });
  }));

  socket.on('music:queue:clear', socketGuard(async () => {
    await ncmExec('queue clear');
    socket.emit('music:queue:cleared', {});
  }));

  // ── Like / Dislike ────────────────────────────────────────────────────

  socket.on('music:like', socketGuard(async (data: { encryptedId: string }) => {
    await ncmExec(`song like --songId "${data.encryptedId}"`);
    socket.emit('music:liked', { encryptedId: data.encryptedId });
  }));

  socket.on('music:dislike', socketGuard(async (data: { encryptedId: string }) => {
    await ncmExec(`song dislike --songId "${data.encryptedId}"`);
    socket.emit('music:disliked', { encryptedId: data.encryptedId });
  }));

  // ── State ─────────────────────────────────────────────────────────────

  socket.on('music:get_state', socketGuard(() => {
    pollAndEmitState(socket);
  }));

  socket.on('disconnect', () => {
    stopStatePoller(uid);
  });
}

// ── State polling ──────────────────────────────────────────────────────────

async function pollAndEmitState(socket: Socket) {
  const raw = await ncmExec('state');
  const result = tryParse(raw);
  const data = result?.state || result;
  if (data) {
    socket.emit('music:state', {
      playing: data.status === 'playing' || data.playing === true,
      trackName: data.trackName || data.name || data.title,
      artists: data.artists || (data.artist ? [data.artist] : undefined),
      album: data.album,
      duration: data.duration,
      progress: data.position || data.progress || 0,
      coverUrl: data.coverUrl || data.cover,
      volume: data.volume,
      source: 'netease',
    });
  }
}

function startStatePoller(socket: Socket, uid: string) {
  stopStatePoller(uid);
  const interval = setInterval(() => pollAndEmitState(socket), 3000);
  userPollers.set(uid, interval);
}

function stopStatePoller(uid: string) {
  const existing = userPollers.get(uid);
  if (existing) {
    clearInterval(existing);
    userPollers.delete(uid);
  }
}

/**
 * Emit a music atmosphere event to trigger the MusicMoodLayer.
 */
export function emitMusicAtmosphere(socket: Socket, atmosphere: MusicAtmosphere) {
  const rooms = Array.from(socket.rooms);
  const userRoom = rooms.find(r => r.startsWith('user:'));
  if (userRoom) {
    socket.to(userRoom).emit('music:atmosphere', atmosphere);
    if (atmosphere.lyrics) socket.to(userRoom).emit('music:lyrics', { lyrics: atmosphere.lyrics });
  }
  socket.emit('music:atmosphere', atmosphere);
  if (atmosphere.lyrics) socket.emit('music:lyrics', { lyrics: atmosphere.lyrics });
  startStatePoller(socket, userRoom || 'default');
}
