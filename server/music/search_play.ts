/**
 * Shared music search + play logic.
 * NetEase playback uses the authenticated ncm-cli/mpv player so account login
 * and VIP access are respected. The frontend mood layer mirrors state/control.
 */
import { execFileSync } from 'child_process';
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

const MUSIC_ADJUSTMENT_PATTERNS = [
  /(?:\u5b89\u9759\u4e00\u70b9|\u66f4\u5b89\u9759|\u8f7b\u4e00\u70b9|\u5c0f\u58f0\u4e00\u70b9|\u522b\u592a\u5435|\u4e0d\u8981\u592a\u5435|\u592a\u5435|\u67d4\u548c\u4e00\u70b9|\u8212\u7f13\u4e00\u70b9|\u653e\u677e\u4e00\u70b9)/u,
  /(?:\u66f4\u71c3|\u71c3\u4e00\u70b9|\u55e8\u4e00\u70b9|\u5e26\u52b2\u4e00\u70b9|\u63d0\u795e|\u4e0a\u5934\u4e00\u70b9|\u70ed\u8840\u4e00\u70b9)/u,
  /(?:\u6362\u4e00\u9996|\u4e0b\u4e00\u9996|\u5207\u6b4c|\u8df3\u8fc7|\u4e0d\u559c\u6b22\u8fd9\u9996|\u8fd9\u9996\u4e0d\u884c)/u,
  /\b(quieter|calmer|softer|too\s+loud|more\s+energetic|more\s+hype|next\s+song|skip\s+this)\b/i,
];

type MusicAdjustmentPlan = {
  mood: string;
  keyword?: string;
  preferLiked?: boolean;
  reply: string;
  source: string;
};

function quoteCmdArg(value: string): string {
  const raw = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '\\"').replace(/([&|<>^%])/g, '^$1')}"`;
}

type NcmCliResult = { ok: boolean; stdout: string; error?: string };

function looksLikeNcmFailure(text: string): boolean {
  return /(api\s*key|未设置|未配置|登录|login|required|failed|failure|失败|错误|error|mpv|player|not\s+found|cannot|无法)/i.test(text);
}

function runNcmCliResult(args: string[], timeout = 15000): NcmCliResult {
  try {
    if (process.platform === 'win32') {
      const cmdline = ['npx.cmd', '@music163/ncm-cli', ...args, '--output', 'json']
        .map(quoteCmdArg)
        .join(' ');
      const stdout = execFileSync('cmd.exe', ['/d', '/c', cmdline], {
        timeout,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      return { ok: true, stdout };
    }
    const stdout = execFileSync('npx', ['@music163/ncm-cli', ...args, '--output', 'json'], {
      timeout,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, stdout };
  } catch (e: any) {
    const stdout = String(e.stdout || '');
    const stderr = String(e.stderr || e.message || '');
    const combined = `${stdout}\n${stderr}`;
    const ok = Boolean(stdout.trim()) && !looksLikeNcmFailure(combined);
    if (!ok) console.warn('[Music] ncm-cli error:', stderr || stdout || e.message);
    return { ok, stdout, error: stderr || stdout || e.message };
  }
}

function runNcmCli(args: string[], timeout = 15000): string {
  const result = runNcmCliResult(args, timeout);
  return result.stdout;
}

function playNcmSong(song: any): { ok: boolean; reason?: string } {
  const { encryptedId, originalId } = getSongIds(song);
  if (!encryptedId || !originalId) {
    return { ok: false, reason: '这首歌缺少网易云播放 ID，无法启动登录态播放。' };
  }
  const result = runNcmCliResult(['play', '--song', '--encrypted-id', encryptedId, '--original-id', originalId], 22000);
  const parsed = tryParse(result.stdout);
  const failed = parsed?.success === false || parsed?.ok === false || !result.ok;
  if (failed) {
    return {
      ok: false,
      reason: result.error || parsed?.message || parsed?.error || '网易云登录态播放启动失败，请检查音乐中心登录、API 凭据和 mpv 播放器。',
    };
  }
  return { ok: true };
}

function queueNcmSongs(songs: any[]): void {
  const queueCandidates = songs
    .map(song => ({ song, ids: getSongIds(song) }))
    .filter(item => item.ids.encryptedId && item.ids.originalId)
    .slice(0, 8);
  if (!queueCandidates.length) return;

  setTimeout(() => {
    for (const item of queueCandidates) {
      runNcmCli([
        'queue',
        'add',
        '--encrypted-id',
        item.ids.encryptedId,
        '--original-id',
        item.ids.originalId,
      ], 8000);
    }
  }, 0);
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

export function isMusicAdjustmentRequest(text?: string): boolean {
  const normalized = (text || '').trim();
  if (!normalized) return false;
  return MUSIC_ADJUSTMENT_PATTERNS.some(pattern => pattern.test(normalized));
}

export function getMusicFailureMessage(reason?: string): string {
  const suffix = reason ? `\n\n${reason}` : '';
  return `我刚刚收到你的音乐请求了，但没有成功启动播放。请打开音乐中心检查网易云音乐登录、ncm-cli/mpv 播放环境，或者换一个更明确的歌名再试。${suffix}`;
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

function normalizeTrack(song: any) {
  return {
    name: song.name || song.title || 'Unknown track',
    artists: normalizeArtists(song),
    album: song.album?.name || song.al?.name,
    duration: Number(song.duration || song.dt || 0),
    coverUrl: song.coverImgUrl || song.album?.picUrl || song.al?.picUrl,
  };
}

async function getLikedPlaylistInfo(): Promise<{ id: string; trackCount: number } | null> {
  const raw = ncmExec(['playlist', 'created']);
  const data = tryParse(raw);
  const records = data?.data?.records || data?.data || [];
  const liked = records.find((r: any) => r.specialType === 5);
  if (!liked?.id) return null;
  return {
    id: liked.id,
    trackCount: Number(liked.trackCount || liked.songCount || liked.musicSize || liked.size || 0),
  };
}

async function getPlaylistSongs(encId: string, limit = 50, totalTracks = 0): Promise<any[]> {
  const maxOffset = Math.max(0, totalTracks - limit);
  const offset = maxOffset > 0 ? Math.floor(Math.random() * (maxOffset + 1)) : 0;
  const raw = ncmExec(['playlist', 'tracks', '--playlistId', encId, '--limit', String(limit), '--offset', String(offset)]);
  const data = tryParse(raw);
  const tracks = data?.data?.records || data?.data || data?.songs || [];
  const playable = tracks.filter((s: any) => s.playFlag !== false);
  if (playable.length > 0 || offset === 0) return playable;
  const fallbackRaw = ncmExec(['playlist', 'tracks', '--playlistId', encId, '--limit', String(limit), '--offset', '0']);
  const fallbackData = tryParse(fallbackRaw);
  const fallbackTracks = fallbackData?.data?.records || fallbackData?.data || fallbackData?.songs || [];
  return fallbackTracks.filter((s: any) => s.playFlag !== false);
}

function isLikedSongsRequest(text: string): boolean {
  return /(?:\u6211.*(?:\u559c\u6b22|\u7ea2\u5fc3|\u6536\u85cf)|\u7ea2\u5fc3|\u559c\u6b22\u7684\u6b4c|\u6536\u85cf\u7684\u6b4c)/u.test(text);
}

function isRecommendRequest(text: string): boolean {
  return /(?:\u63a8\u8350|\u6bcf\u65e5|\u65e5\u63a8|\u4eca\u65e5\u63a8\u8350|\u4eca\u5929.*(?:\u542c|\u653e)|\u968f\u4fbf|\u6765\u70b9)/u.test(text);
}

function getMusicAdjustmentPlan(text: string, fallbackMood: string): MusicAdjustmentPlan {
  if (/(?:\u5b89\u9759\u4e00\u70b9|\u66f4\u5b89\u9759|\u8f7b\u4e00\u70b9|\u5c0f\u58f0\u4e00\u70b9|\u522b\u592a\u5435|\u4e0d\u8981\u592a\u5435|\u592a\u5435|\u67d4\u548c\u4e00\u70b9|\u8212\u7f13\u4e00\u70b9|\u653e\u677e\u4e00\u70b9|quieter|calmer|softer|too\s+loud)/iu.test(text)) {
    return {
      mood: 'peaceful',
      keyword: '\u5b89\u9759 \u6cbb\u6108 \u8f7b\u97f3\u4e50',
      reply: '\u597d\uff0c\u6211\u628a\u97f3\u4e50\u8c03\u5f97\u66f4\u5b89\u9759\u4e00\u70b9\u3002',
      source: 'adjust-quiet',
    };
  }
  if (/(?:\u66f4\u71c3|\u71c3\u4e00\u70b9|\u55e8\u4e00\u70b9|\u5e26\u52b2\u4e00\u70b9|\u63d0\u795e|\u4e0a\u5934\u4e00\u70b9|\u70ed\u8840\u4e00\u70b9|more\s+energetic|more\s+hype)/iu.test(text)) {
    return {
      mood: 'excited',
      keyword: '\u70ed\u6b4c \u71c3 \u6447\u6eda \u6d41\u884c',
      reply: '\u597d\uff0c\u4e0b\u4e00\u9996\u7ed9\u4f60\u6362\u5f97\u66f4\u71c3\u4e00\u70b9\u3002',
      source: 'adjust-hype',
    };
  }
  if (/(?:\u6362\u4e00\u9996|\u4e0b\u4e00\u9996|\u5207\u6b4c|\u8df3\u8fc7|\u4e0d\u559c\u6b22\u8fd9\u9996|\u8fd9\u9996\u4e0d\u884c|next\s+song|skip\s+this)/iu.test(text)) {
    return {
      mood: fallbackMood || 'peaceful',
      preferLiked: true,
      reply: '\u597d\uff0c\u6211\u7ed9\u4f60\u6362\u4e00\u9996\u3002',
      source: 'adjust-next',
    };
  }
  return {
    mood: fallbackMood || 'peaceful',
    preferLiked: true,
    reply: '\u597d\uff0c\u6211\u6309\u4f60\u73b0\u5728\u7684\u611f\u89c9\u6362\u4e00\u9996\u3002',
    source: 'adjust-mood',
  };
}

async function getDailySongs(limit = 30): Promise<any[]> {
  const raw = ncmExec(['recommend', 'daily', '--limit', String(limit)]);
  const data = tryParse(raw);
  const tracks = data?.data?.records || data?.data || data?.songs || [];
  return tracks.filter((s: any) => s.playFlag !== false);
}

async function searchSongsByKeyword(keyword: string, limit = 20): Promise<any[]> {
  const searchRaw = ncmExec(['search', 'song', '--keyword', keyword, '--limit', String(limit)]);
  const searchData = tryParse(searchRaw);
  return getSongs(searchData);
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
  const playableWithIds = playable.filter((s: any) => {
    const ids = getSongIds(s);
    return Boolean(ids.encryptedId && ids.originalId);
  });
  if (playableWithIds.length === 0) return { success: false, reason: '没有找到带网易云播放 ID 的候选歌曲。' };
  console.log(`[Music] ${source}: ${playableWithIds.length} account-playable candidates from ${candidates.length} candidates`);

  const pick = playableWithIds[Math.floor(Math.random() * playableWithIds.length)];
  const { encryptedId, originalId } = getSongIds(pick);
  const trackInfo = normalizeTrack(pick);
  const nativePlay = playNcmSong(pick);
  if (!nativePlay.ok) return { success: false, reason: nativePlay.reason };

  queueNcmSongs(playableWithIds.filter(song => song !== pick));
  const seenQueueItems = new Set<string>();
  const queue = [pick, ...playableWithIds.filter(song => song !== pick)].reduce((items, song) => {
    if (items.length >= 20) return items;
    const ids = getSongIds(song);
    const track = normalizeTrack(song);
    const key = ids.originalId || ids.encryptedId || `${track.name}:${track.artists.join(',')}`;
    if (seenQueueItems.has(key)) return items;
    seenQueueItems.add(key);
    items.push({ track, encryptedId: ids.encryptedId, originalId: ids.originalId });
    return items;
  }, [] as Array<{ track: ReturnType<typeof normalizeTrack>; encryptedId: string; originalId: string }>);
  const queueIndex = 0;

  console.log(`[Music] Selected and started through NetEase account playback: "${trackInfo.name}"`);

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

  console.log(`[Music] Scene: ${scene.scene}, particles=${scene.particles}, nativePlayback=true`);
  emitMusicAtmosphere(socket, {
    track: trackInfo,
    mood,
    nativePlayback: true,
    queue,
    queueIndex,
    lyrics: lyricsData,
    lumiReason,
    scene,
  });

  return { success: true, text: lumiReason };
}

export async function adjustMusicPlayback(
  userId: string,
  socket: any,
  userText: string,
): Promise<MusicPlayResult> {
  const emotionalState = loadEmotionalState(userId);
  const fallbackMood = emotionalState.dominantMood || 'peaceful';
  const plan = getMusicAdjustmentPlan(userText, fallbackMood);
  let songs: any[] = [];

  if (plan.preferLiked) {
    const liked = await getLikedPlaylistInfo();
    if (liked) songs = await getPlaylistSongs(liked.id, 50, liked.trackCount);
  }

  if (songs.length === 0 && plan.keyword) {
    songs = await searchSongsByKeyword(plan.keyword, 20);
  }

  if (songs.length === 0 && !plan.preferLiked) {
    const liked = await getLikedPlaylistInfo();
    if (liked) songs = await getPlaylistSongs(liked.id, 50, liked.trackCount);
  }

  if (songs.length === 0) {
    songs = await getDailySongs(30);
  }

  if (songs.length === 0) {
    return { success: false, reason: '\u6ca1\u6709\u627e\u5230\u53ef\u7528\u7684\u4e0b\u4e00\u9996\u5019\u9009\u6b4c\u66f2\u3002' };
  }

  const result = await pickAndPlay(socket, userId, plan.mood, songs, plan.source);
  if (!result.success) return result;
  return {
    ...result,
    text: [plan.reply, result.text].filter(Boolean).join('\n'),
  };
}

export async function searchAndPlay(
  userId: string,
  socket: any,
  userText?: string,
): Promise<MusicPlayResult> {
  const emotionalState = loadEmotionalState(userId);
  const mood = emotionalState.dominantMood || 'peaceful';

  if (userText && isLikedSongsRequest(userText)) {
    const liked = await getLikedPlaylistInfo();
    if (liked) {
      const songs = await getPlaylistSongs(liked.id, 50, liked.trackCount);
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
      const searchRaw = ncmExec(['search', 'song', '--keyword', target, '--limit', '20']);
      const searchData = tryParse(searchRaw);
      const songs = getSongs(searchData);
      if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'search');
      return { success: false, reason: `没有搜索到“${target}”的可播放结果。` };
    }
  }

  const liked = await getLikedPlaylistInfo();
  if (liked) {
    const songs = await getPlaylistSongs(liked.id, 50, liked.trackCount);
    if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'liked');
  }

  const keyword = moodSearchMap[mood] || '\u63a8\u8350 \u70ed\u95e8';
  const searchRaw = ncmExec(['search', 'song', '--keyword', keyword, '--limit', '20']);
  const searchData = tryParse(searchRaw);
  const songs = getSongs(searchData);
  if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'search');

  return { success: false, reason: '网易云搜索没有返回可播放歌曲，可能是登录、网络或 ncm-cli 播放环境异常。' };
}
