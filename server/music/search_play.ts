/**
 * Shared music search + play logic.
 * Search uses ncm-cli when available; playback is attempted through ncm-cli/mpv
 * and also exposed to the client as a public audio URL fallback.
 */
import { execFile, execFileSync } from 'child_process';
import { loadEmotionalState } from '../personality/state';
import { emitMusicAtmosphere } from '../socket/music';
import { getFallbackScene, MusicScene } from './scene_generator';

export type MusicPlayResult = { success: boolean; text?: string; reason?: string };

const moodSearchMap: Record<string, string> = {
  happy: '\u6b22\u5feb \u6d41\u884c',
  playful: '\u8f7b\u677e \u6cbb\u6108',
  warm: '\u6e29\u6696 \u6c11\u8c23',
  sad: '\u4f24\u611f \u5b89\u9759',
  melancholic: '\u6000\u65e7 \u8001\u6b4c',
  tired: '\u8f7b\u97f3\u4e50 \u7eaf\u97f3\u4e50',
  curious: '\u65b0\u6b4c \u63a8\u8350',
  focused: '\u4e13\u6ce8 \u7eaf\u97f3\u4e50',
  contemplative: '\u5b89\u9759 \u94a2\u7434',
  excited: '\u70ed\u6b4c \u55e8',
  peaceful: '\u6cbb\u6108 \u8f7b\u677e',
};

const moodReasonMap: Record<string, string> = {
  tired: '\u611f\u89c9\u4f60\u6709\u70b9\u7d2f\u4e86',
  sad: '\u611f\u89c9\u4f60\u5fc3\u60c5\u4e0d\u592a\u597d',
  happy: '\u611f\u89c9\u4f60\u4eca\u5929\u5fc3\u60c5\u4e0d\u9519',
  excited: '\u611f\u89c9\u4f60\u5f88\u5174\u594b',
  peaceful: '\u73b0\u5728\u633a\u5b89\u9759\u7684',
  contemplative: '\u4f60\u597d\u50cf\u5728\u60f3\u4e8b\u60c5',
  focused: '\u4f60\u5728\u4e13\u6ce8\u5de5\u4f5c',
  melancholic: '\u6709\u70b9\u6000\u65e7\u7684\u611f\u89c9',
  warm: '\u611f\u89c9\u633a\u6e29\u6696\u7684',
};

const MUSIC_PLAYBACK_PATTERNS = [
  /\b(play|put\s+on|listen\s+to|start)\b.*\b(music|song|playlist|album|track)\b/i,
  /(?:\u653e|\u64ad\u653e|\u542c|\u6765\u4e00\u9996|\u6765\u70b9|\u70b9\u4e00\u9996|\u64ad\u4e00\u9996).*(?:\u97f3\u4e50|\u6b4c|\u6b4c\u66f2|\u6b4c\u5355|\u65e5\u63a8|\u6bcf\u65e5\u63a8\u8350|\u4e13\u8f91|\u7eaf\u97f3\u4e50)/u,
  /(?:\u97f3\u4e50|\u6b4c|\u6b4c\u66f2|\u6b4c\u5355|\u65e5\u63a8|\u6bcf\u65e5\u63a8\u8350).*(?:\u653e|\u64ad\u653e|\u542c|\u6765|\u5f00)/u,
];

function quoteCmdArg(value: string): string {
  const raw = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '\\"').replace(/([&|<>^%])/g, '^$1')}"`;
}

function runNcmCli(args: string[], timeout = 15000): string {
  try {
    if (process.platform === 'win32') {
      const cmdline = ['npx.cmd', '@music163/ncm-cli', ...args, '--output', 'json']
        .map(quoteCmdArg)
        .join(' ');
      return execFileSync('cmd.exe', ['/d', '/c', cmdline], {
        timeout,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
    }
    return execFileSync('npx', ['@music163/ncm-cli', ...args, '--output', 'json'], {
      timeout,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
  } catch (e: any) {
    if (e.stdout) return e.stdout;
    console.warn('[Music] ncm-cli error:', e.stderr || e.message);
    return '';
  }
}

function ncmExec(args: string[], timeout = 15000): string {
  return runNcmCli(args, timeout);
}

function tryParse(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

export function isMusicPlaybackRequest(text?: string): boolean {
  const normalized = (text || '').trim();
  if (!normalized) return false;
  return MUSIC_PLAYBACK_PATTERNS.some(pattern => pattern.test(normalized));
}

export function getMusicFailureMessage(reason?: string): string {
  const suffix = reason ? `\n\n${reason}` : '';
  return `我刚刚收到你的音乐请求了，但没有成功启动播放。请打开音乐中心检查网易云音乐登录、ncm-cli/mpv 播放环境，或者换一个更明确的歌名再试。${suffix}`;
}

function ncmFirePlay(encryptedId: string, originalId: string): void {
  const args = ['play', '--song', '--encrypted-id', encryptedId, '--original-id', originalId, '--output', 'json'];
  if (process.platform === 'win32') {
    const cmdline = ['npx.cmd', '@music163/ncm-cli', ...args].map(quoteCmdArg).join(' ');
    execFile('cmd.exe', ['/d', '/c', cmdline], { timeout: 30000, windowsHide: true }, (err) => {
      if (err && !(err as any).killed) console.warn('[Music] ncm-cli play error:', err.message);
    });
    return;
  }
  execFile('npx', ['@music163/ncm-cli', ...args], { timeout: 30000 }, (err) => {
    if (err && !(err as any).killed) console.warn('[Music] ncm-cli play error:', err.message);
  });
}

function getSongIds(song: any): { encryptedId: string; originalId: string } {
  const encryptedId = String(song?.id || song?.encryptedId || song?.songId || '').trim();
  const originalId = String(song?.originalId || song?.originId || song?.songId || (/^\d+$/.test(encryptedId) ? encryptedId : '')).trim();
  return { encryptedId, originalId };
}

function getPublicAudioUrl(song: any): string {
  const { encryptedId, originalId } = getSongIds(song);
  const id = originalId || (/^\d+$/.test(encryptedId) ? encryptedId : '');
  return id ? `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(id)}.mp3` : '';
}

function normalizeArtists(song: any): string[] {
  const raw = song?.artists || song?.fullArtists || song?.ar || song?.artist || [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((artist: any) => typeof artist === 'string' ? artist : artist?.name)
    .filter(Boolean);
}

async function getLikedPlaylistEncId(): Promise<string | null> {
  const raw = ncmExec(['playlist', 'created']);
  const data = tryParse(raw);
  const records = data?.data?.records || data?.data || [];
  const liked = records.find((r: any) => r.specialType === 5);
  return liked?.id || null;
}

async function getPlaylistSongs(encId: string, limit = 50): Promise<any[]> {
  const offset = Math.floor(Math.random() * 200);
  const raw = ncmExec(['playlist', 'tracks', '--playlistId', encId, '--limit', String(limit), '--offset', String(offset)]);
  const data = tryParse(raw);
  const tracks = data?.data?.records || data?.data || data?.songs || [];
  return tracks.filter((s: any) => s.playFlag !== false);
}

function isLikedSongsRequest(text: string): boolean {
  return /(?:\u6211.*(?:\u559c\u6b22|\u7ea2\u5fc3|\u6536\u85cf)|\u7ea2\u5fc3|\u559c\u6b22\u7684\u6b4c|\u6536\u85cf\u7684\u6b4c)/u.test(text);
}

function isRecommendRequest(text: string): boolean {
  return /(?:\u63a8\u8350|\u6bcf\u65e5|\u65e5\u63a8|\u4eca\u65e5\u63a8\u8350|\u4eca\u5929.*(?:\u542c|\u653e)|\u968f\u4fbf|\u6765\u70b9)/u.test(text);
}

async function getDailySongs(limit = 30): Promise<any[]> {
  const raw = ncmExec(['recommend', 'daily', '--limit', String(limit)]);
  const data = tryParse(raw);
  const tracks = data?.data?.records || data?.data || data?.songs || [];
  return tracks.filter((s: any) => s.playFlag !== false);
}

function extractTarget(userText: string): string | null {
  let text = userText.replace(/[\u3002\uff01\uff1f\uff0c,.!?\s]+/g, ' ').trim();
  const prefixWords = /^(?:lumi|Lumi|\u9732\u7c73)?\s*(?:\u8bf7|\u5e2e\u6211|\u7ed9\u6211|\u5e2e\u5fd9|\u9ebb\u70e6|\u6211\u60f3|\u6211\u8981)?\s*(?:\u653e|\u64ad\u653e|\u542c|\u6765\u4e00\u9996|\u6765\u70b9|\u70b9\u4e00\u9996|\u64ad\u4e00\u9996|\u6253\u5f00\u97f3\u4e50|\u97f3\u4e50\u6a21\u5f0f)\s*/u;
  const suffixWords = /\s*(?:\u7684?\u6b4c|\u6b4c\u66f2|\u97f3\u4e50|\u6b4c\u5355|\u4e13\u8f91|\u5427|\u5440|\u5462|\u554a)$/u;

  for (let i = 0; i < 4; i++) {
    const before = text;
    text = text.replace(prefixWords, '').replace(suffixWords, '').trim();
    if (text === before) break;
  }

  if (!text || /^(?:\u6b4c|\u97f3\u4e50|\u6b4c\u66f2|\u6765\u4e00\u9996|\u968f\u4fbf|\u63a8\u8350|\u70ed\u95e8|\u597d\u542c|\u65e5\u63a8|\u6bcf\u65e5\u63a8\u8350)$/u.test(text)) return null;
  return text.length > 0 && text.length <= 30 ? text : null;
}

function getSongs(data: any): any[] {
  return data?.data?.records || data?.data?.songs || data?.result?.songs || data?.songs || [];
}

async function pickAndPlay(
  socket: any,
  userId: string,
  mood: string,
  candidates: any[],
  source: string,
): Promise<MusicPlayResult> {
  const playable = candidates.filter((s: any) => s.playFlag !== false);
  if (playable.length === 0) return { success: false, reason: '没有找到可播放的候选歌曲。' };
  console.log(`[Music] ${source}: ${playable.length} playable from ${candidates.length} candidates`);

  const pick = playable[Math.floor(Math.random() * playable.length)];
  const { encryptedId, originalId } = getSongIds(pick);
  const trackInfo = {
    name: pick.name || pick.title || 'Unknown track',
    artists: normalizeArtists(pick),
    album: pick.album?.name || pick.al?.name,
    duration: Number(pick.duration || pick.dt || 0),
    coverUrl: pick.coverImgUrl || pick.album?.picUrl || pick.al?.picUrl,
  };

  if (encryptedId && originalId) ncmFirePlay(encryptedId, originalId);
  console.log(`[Music] Selected: "${trackInfo.name}"`);

  const emotionalState = loadEmotionalState(userId);
  let lyricsData: any[] = [];
  try {
    const lyricRaw = ncmExec(['song', 'lyric', '--songId', encryptedId || originalId], 10000);
    const lyricJson = tryParse(lyricRaw);
    const lrcText = lyricJson?.data?.lyric || '';
    for (const line of lrcText.split('\n')) {
      const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/);
      if (!match) continue;
      const time = parseInt(match[1]) * 60 + parseInt(match[2]) + parseInt(match[3]) / (match[3].length === 3 ? 1000 : 100);
      const lyricText = match[4].trim();
      if (lyricText) lyricsData.push({ time, text: lyricText });
    }
  } catch {}

  let scene: MusicScene = getFallbackScene(mood, { valence: emotionalState.valence, arousal: emotionalState.arousal });
  try {
    const { generateMusicScene } = await import('../music/scene_generator');
    const llmScene = await generateMusicScene(userId, trackInfo, mood);
    if (llmScene) scene = llmScene;
  } catch {}

  const reasonPhrase = moodReasonMap[mood] || '根据你现在的状态';
  const lumiReason = `${reasonPhrase}，给你放一首《${trackInfo.name}》，希望你喜欢。`;
  const audioUrl = getPublicAudioUrl(pick);

  console.log(`[Music] Scene: ${scene.scene}, particles=${scene.particles}, audioFallback=${Boolean(audioUrl)}`);
  emitMusicAtmosphere(socket, {
    track: trackInfo,
    mood,
    audioUrl,
    lyrics: lyricsData,
    lumiReason,
    scene,
  });

  return { success: true, text: lumiReason };
}

export async function searchAndPlay(
  userId: string,
  socket: any,
  userText?: string,
): Promise<MusicPlayResult> {
  const emotionalState = loadEmotionalState(userId);
  const mood = emotionalState.dominantMood || 'peaceful';

  if (userText && isLikedSongsRequest(userText)) {
    const encId = await getLikedPlaylistEncId();
    if (encId) {
      const songs = await getPlaylistSongs(encId);
      if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'liked');
    }
    return { success: false, reason: '没有读取到喜欢/收藏歌单，可能还没有登录网易云音乐。' };
  }

  if (userText && isRecommendRequest(userText)) {
    const songs = await getDailySongs(30);
    if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'daily');
    return { success: false, reason: '没有读取到每日推荐，可能还没有登录网易云音乐。' };
  }

  if (userText) {
    const target = extractTarget(userText);
    if (target) {
      console.log(`[Music] User target: "${target}"`);
      const searchRaw = ncmExec(['search', 'song', '--keyword', target, '--limit', '5']);
      const searchData = tryParse(searchRaw);
      const songs = getSongs(searchData);
      if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'search');
      return { success: false, reason: `没有搜索到“${target}”的可播放结果。` };
    }
  }

  const encId = await getLikedPlaylistEncId();
  if (encId) {
    const songs = await getPlaylistSongs(encId, 30);
    if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'liked');
  }

  const keyword = moodSearchMap[mood] || '\u63a8\u8350 \u70ed\u95e8';
  const searchRaw = ncmExec(['search', 'song', '--keyword', keyword, '--limit', '5']);
  const searchData = tryParse(searchRaw);
  const songs = getSongs(searchData);
  if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'search');

  return { success: false, reason: '网易云搜索没有返回可播放歌曲，可能是登录、网络或 ncm-cli 播放环境异常。' };
}
