/**
 * Shared music search + play logic.
 * NetEase playback uses the authenticated ncm-cli/mpv player so account login
 * and VIP access are respected. The frontend mood layer mirrors state/control.
 */
import { loadEmotionalState } from '../personality/state';
import { emitMusicAtmosphere } from '../socket/music';
import { getFallbackScene, MusicScene } from './scene_generator';
import { getNcmPlaybackStateAsync, runNcmCliAsync } from './ncm_cli';
import { getCachedMusicProfile } from './library_profile';
import { getNeteaseLyricText, searchNeteaseSongs } from './netease_public';

export type MusicPlayResult = { success: boolean; text?: string; reason?: string };

const moodSearchMap: Record<string, string> = {
  happy: '欢快 流行',
  playful: '轻松 治愈',
  warm: '温暖 民谣',
  sad: '伤感 安静',
  melancholic: '怀旧 老歌',
  tired: '轻音乐 纯音乐',
  curious: '新歌 推荐',
  focused: '专注 纯音乐',
  contemplative: '安静 钢琴',
  excited: '热歌 嗨',
  peaceful: '治愈 轻松',
};

const moodReasonMap: Record<string, string> = {
  tired: '感觉你有点累了',
  sad: '感觉你心情不太好',
  happy: '感觉你今天心情不错',
  excited: '感觉你很兴奋',
  peaceful: '现在挺安静的',
  contemplative: '你像是在想事情',
  focused: '你在专注工作',
  melancholic: '有点怀旧的感觉',
  warm: '感觉挺温暖的',
};

const MUSIC_PLAYBACK_PATTERNS = [
  /\b(play|put\s+on|listen\s+to|start)\b.*\b(music|song|playlist|album|track)\b/i,
  /(?:放|播放|听|来一首|来点|点一首|播一首).*(?:音乐|歌|歌曲|歌单|日推|每日推荐|专辑|纯音乐)/u,
  /(?:音乐|歌|歌曲|歌单|日推|每日推荐).*(?:放|播放|听|来|开)/u,
];

const MUSIC_ADJUSTMENT_PATTERNS = [
  /(?:安静一点|更安静|轻一点|小声一点|别太吵|不要太吵|太吵|柔和一点|舒缓一点|放松一点)/u,
  /(?:更燃|燃一点|嗨一点|带劲一点|提神|上头一点|热血一点)/u,
  /(?:换一首|下一首|切歌|跳过|不喜欢这首|这首不行)/u,
  /\b(quieter|calmer|softer|too\s+loud|more\s+energetic|more\s+hype|next\s+song|skip\s+this)\b/i,
];

type MusicAdjustmentPlan = {
  mood: string;
  keyword?: string;
  preferLiked?: boolean;
  reply: string;
  source: string;
};

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tryParse(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

async function ncmExec(args: string[], timeout = 15000): Promise<string> {
  const result = await runNcmCliAsync(args, timeout);
  if (!result.ok) console.warn('[Music] ncm-cli error:', result.error || result.stderr || result.stdout);
  return result.stdout;
}

async function waitForNcmPlayingState(attempts = 6, delayMs = 650): Promise<any | null> {
  let lastState: any | null = null;
  for (let i = 0; i < attempts; i += 1) {
    const state = await getNcmPlaybackStateAsync(8000);
    if (state) lastState = state;
    if (state?.status === 'playing' || state?.playing === true) return state;
    await delay(delayMs);
  }
  return lastState;
}

async function playNcmSongVerified(song: any): Promise<{ ok: boolean; reason?: string }> {
  const { encryptedId, originalId } = getSongIds(song);
  if (!encryptedId || !originalId) {
    return { ok: false, reason: '这首歌缺少网易云播放 ID，无法启动账号播放。' };
  }

  const result = await runNcmCliAsync(['play', '--song', '--encrypted-id', encryptedId, '--original-id', originalId], 22000);
  const parsed = tryParse(result.stdout);
  if (!result.ok || parsed?.success === false || parsed?.ok === false) {
    return {
      ok: false,
      reason: result.error || parsed?.message || parsed?.error || '网易云账号播放启动失败，请检查音乐中心登录、开放平台 API 凭据和 mpv 播放器。',
    };
  }

  let state = await waitForNcmPlayingState();
  if (state?.status !== 'playing' && state?.playing !== true) {
    await runNcmCliAsync(['resume'], 8000);
    state = await waitForNcmPlayingState(4, 700);
  }

  if (state?.status !== 'playing' && state?.playing !== true) {
    const status = state?.status || 'unknown';
    return {
      ok: false,
      reason: `网易云播放命令已发送，但播放器没有进入播放状态（当前状态：${status}）。请检查 mpv 是否可用，或重新登录网易云音乐。`,
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
      void runNcmCliAsync([
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
  return `我收到你的音乐请求了，但网易云主播放链路没有完整启动。请先检查音乐中心的网易云登录、开放平台 API 凭据和 mpv 播放器。${suffix}`;
}

function getSongIds(song: any): { encryptedId: string; originalId: string } {
  const encryptedId = String(song?.id || song?.encryptedId || song?.songId || '').trim();
  const originalId = String(song?.originalId || song?.originId || song?.songId || (/^\d+$/.test(encryptedId) ? encryptedId : '')).trim();
  return { encryptedId, originalId };
}

function hasNcmEncryptedId(song: any): boolean {
  const { encryptedId, originalId } = getSongIds(song);
  return Boolean(encryptedId && originalId && !/^\d+$/.test(encryptedId));
}

function extractNcmSearchRecords(data: any): any[] {
  const records = data?.data?.records || data?.records || data?.songs || data?.data || [];
  return Array.isArray(records) ? records : [];
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

function isLikedSongsRequest(text: string): boolean {
  return /(?:我.*(?:喜欢|红心|收藏)|红心|喜欢的歌|收藏的歌)/u.test(text);
}

function isRecommendRequest(text: string): boolean {
  return /(?:推荐|每日|日推|今日推荐|今天.*(?:听|放)|随便|来点)/u.test(text);
}

function getMusicAdjustmentPlan(text: string, fallbackMood: string): MusicAdjustmentPlan {
  if (/(?:安静一点|更安静|轻一点|小声一点|别太吵|不要太吵|太吵|柔和一点|舒缓一点|放松一点|quieter|calmer|softer|too\s+loud)/iu.test(text)) {
    return {
      mood: 'peaceful',
      keyword: '安静 治愈 轻音乐',
      reply: '好，我把音乐调得更安静一点。',
      source: 'adjust-quiet',
    };
  }
  if (/(?:更燃|燃一点|嗨一点|带劲一点|提神|上头一点|热血一点|more\s+energetic|more\s+hype)/iu.test(text)) {
    return {
      mood: 'excited',
      keyword: '热歌 燃 摇滚 流行',
      reply: '好，下一首给你换得更燃一点。',
      source: 'adjust-hype',
    };
  }
  if (/(?:换一首|下一首|切歌|跳过|不喜欢这首|这首不行|next\s+song|skip\s+this)/iu.test(text)) {
    return {
      mood: fallbackMood || 'peaceful',
      preferLiked: true,
      reply: '好，我给你换一首。',
      source: 'adjust-next',
    };
  }
  return {
    mood: fallbackMood || 'peaceful',
    preferLiked: true,
    reply: '好，我按你现在的感觉换一首。',
    source: 'adjust-mood',
  };
}

async function getDailySongs(limit = 30): Promise<any[]> {
  const raw = await ncmExec(['recommend', 'daily', '--limit', String(limit)]);
  const data = tryParse(raw);
  const tracks = data?.data?.records || data?.data || data?.songs || [];
  return tracks.filter((s: any) => s.playFlag !== false);
}

async function searchSongsByKeyword(keyword: string, limit = 20): Promise<any[]> {
  const raw = await ncmExec(['search', 'song', '--keyword', keyword, '--limit', String(limit)]);
  const data = tryParse(raw);
  const records = extractNcmSearchRecords(data).filter((s: any) => s.playFlag !== false);
  if (records.length > 0) return records;

  const publicSongs = await searchNeteaseSongs(keyword, limit);
  return hydrateNcmPlayableSongs(publicSongs, Math.min(limit, 12));
}

function extractTarget(userText: string): string | null {
  let text = userText.replace(/[。！？,.!?\s]+/g, ' ').trim();
  const prefixWords = /^(?:lumi|Lumi|露米)?\s*(?:请|帮我|给我|帮忙|麻烦|我想|我要)?\s*(?:放|播放|听|来一首|来点|点一首|播一首|打开音乐|音乐模式)\s*/u;
  const suffixWords = /\s*(?:的?歌|歌曲|音乐|歌单|专辑|吧|呀|呢|啊)$/u;

  for (let i = 0; i < 4; i += 1) {
    const before = text;
    text = text.replace(prefixWords, '').replace(suffixWords, '').trim();
    if (text === before) break;
  }

  if (!text || /^(?:首|一首|一些|几首|歌|音乐|歌曲|来一首|随便|随便一首|推荐|热门|好听|日推|每日推荐)$/u.test(text)) return null;
  return text.length > 0 && text.length <= 30 ? text : null;
}

function getCachedProfileSongs(userId: string, limit = 60): any[] {
  const profile = getCachedMusicProfile(userId);
  const sampleTracks = profile?.sampleTracks || [];
  return sampleTracks.slice(0, limit).map(track => ({
    id: track.id,
    originalId: track.id,
    name: track.name,
    artists: track.artists,
    album: track.album ? { name: track.album } : undefined,
    duration: track.duration,
    coverImgUrl: track.coverUrl,
    playFlag: true,
  }));
}

async function lookupNcmPlayableSong(song: any): Promise<any | null> {
  if (hasNcmEncryptedId(song)) return song;
  const ids = getSongIds(song);
  const track = normalizeTrack(song);
  const keyword = [track.name, track.artists[0]].filter(Boolean).join(' ').trim();
  if (!keyword) return null;

  const raw = await ncmExec(['search', 'song', '--keyword', keyword, '--limit', '10'], 15000);
  const records = extractNcmSearchRecords(tryParse(raw)).filter((record: any) => record.playFlag !== false);
  if (!records.length) return null;

  const exactId = ids.originalId
    ? records.find((record: any) => String(record.originalId || record.originId || '') === ids.originalId)
    : null;
  const exactName = records.find((record: any) => String(record.name || '').trim() === String(track.name || '').trim());
  const match = exactId || exactName || records[0];
  return match ? { ...song, ...match, encryptedId: match.id, originalId: String(match.originalId || match.originId || ids.originalId || '') } : null;
}

async function hydrateNcmPlayableSongs(candidates: any[], limit = 20): Promise<any[]> {
  const hydrated: any[] = [];
  for (const song of candidates.slice(0, limit)) {
    const playable = await lookupNcmPlayableSong(song);
    if (playable && hasNcmEncryptedId(playable)) hydrated.push(playable);
  }
  return hydrated;
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

  const playableWithIds = await hydrateNcmPlayableSongs(playable, 20);
  if (playableWithIds.length === 0) return { success: false, reason: '没有找到带网易云播放 ID 的候选歌曲。' };
  console.log(`[Music] ${source}: ${playableWithIds.length} account-playable candidates from ${candidates.length} candidates`);

  const pick = playableWithIds[Math.floor(Math.random() * playableWithIds.length)];
  const { encryptedId, originalId } = getSongIds(pick);
  const trackInfo = normalizeTrack(pick);
  const nativePlay = await playNcmSongVerified(pick);
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

  console.log(`[Music] Selected and started through NetEase account playback: "${trackInfo.name}"`);

  const emotionalState = loadEmotionalState(userId);
  let lyricsData: any[] = [];
  try {
    const lrcText = await getNeteaseLyricText(originalId || encryptedId);
    for (const line of lrcText.split('\n')) {
      const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/);
      if (!match) continue;
      const time = parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + parseInt(match[3], 10) / (match[3].length === 3 ? 1000 : 100);
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

  const moodReason = moodReasonMap[mood] || '根据你现在的状态';
  const lumiReason = `${moodReason}，给你放一首《${trackInfo.name}》，希望你喜欢。`;

  console.log(`[Music] Scene: ${scene.scene}, particles=${scene.particles}, nativePlayback=true`);
  emitMusicAtmosphere(socket, {
    track: trackInfo,
    mood,
    nativePlayback: true,
    queue,
    queueIndex: 0,
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

  if (plan.preferLiked) songs = getCachedProfileSongs(userId, 80);
  if (songs.length === 0 && plan.keyword) songs = await searchSongsByKeyword(plan.keyword, 20);
  if (songs.length === 0 && !plan.preferLiked) songs = getCachedProfileSongs(userId, 80);
  if (songs.length === 0) songs = await getDailySongs(30);
  if (songs.length === 0) songs = getCachedProfileSongs(userId, 60);

  if (songs.length === 0) {
    return { success: false, reason: '没有找到可用的下一首候选歌曲。' };
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
    const cachedSongs = getCachedProfileSongs(userId, 80);
    if (cachedSongs.length > 0) return pickAndPlay(socket, userId, mood, cachedSongs, 'liked-profile');
    return { success: false, reason: '没有可用于播放的本地音乐画像，请先在音乐中心生成一次音乐画像。' };
  }

  if (userText && isRecommendRequest(userText)) {
    const songs = await getDailySongs(30);
    if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'daily');
    const cachedSongs = getCachedProfileSongs(userId, 80);
    if (cachedSongs.length > 0) return pickAndPlay(socket, userId, mood, cachedSongs, 'liked-profile');
    return { success: false, reason: '没有读取到每日推荐，可能还没有登录网易云音乐。' };
  }

  if (userText) {
    const target = extractTarget(userText);
    if (target) {
      console.log(`[Music] User target: "${target}"`);
      const songs = await searchSongsByKeyword(target, 20);
      if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'search');
      return { success: false, reason: `没有搜索到“${target}”的可播放结果。` };
    }
  }

  const cachedSongs = getCachedProfileSongs(userId, 80);
  if (cachedSongs.length > 0) return pickAndPlay(socket, userId, mood, cachedSongs, 'liked-profile');

  const keyword = moodSearchMap[mood] || '推荐 热门';
  const songs = await searchSongsByKeyword(keyword, 20);
  if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'search');

  return { success: false, reason: '网易云搜索没有返回可播放歌曲，可能是登录、网络或 ncm-cli 播放环境异常。' };
}
