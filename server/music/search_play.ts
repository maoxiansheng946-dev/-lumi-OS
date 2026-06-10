/**
 * Shared music search + play logic.
 * Search via ncm-cli (authenticated, VIP supported).
 * Playback via ncm-cli mpv (authenticated stream).
 * Frontend syncs state via WebSocket poller.
 */
import { exec } from 'child_process';
import { loadEmotionalState } from '../personality/state';
import { emitMusicAtmosphere } from '../socket/music';
import { getFallbackScene, MusicScene } from './scene_generator';

const moodSearchMap: Record<string, string> = {
  happy: '欢快 流行', playful: '轻松 治愈', warm: '温暖 民谣',
  sad: '伤感 安静', melancholic: '怀旧 老歌', tired: '轻音乐 纯音乐',
  curious: '新歌 推荐', focused: '专注 纯音乐', contemplative: '安静 钢琴',
  excited: '热歌 嗨', peaceful: '治愈 轻松',
};

const moodReasonMap: Record<string, string> = {
  tired: '感觉你有点累了', sad: '感觉你心情不太好', happy: '感觉你今天心情不错',
  excited: '感觉你挺兴奋的', peaceful: '现在挺安静的', contemplative: '你好像在想事情',
  focused: '你在专注工作呢', melancholic: '有点怀旧的感觉', warm: '感觉挺温暖的',
};

function ncmExec(args: string, timeout = 15000): Promise<string> {
  const mpvPath = 'C:\\Program Files\\MPV Player';
  return new Promise((resolve) => {
    exec(`npx @music163/ncm-cli ${args} --output json`, {
      timeout,
      env: { ...process.env, PATH: `${mpvPath};${process.env.PATH || ''}` },
    }, (err, stdout) => {
      resolve(stdout || '');
    });
  });
}

function tryParse(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

/** Fire-and-forget ncm-cli play — mpv handles audio, frontend syncs via poller */
function ncmFirePlay(encryptedId: string, originalId: string): void {
  const mpvPath = 'C:\\Program Files\\MPV Player';
  exec(`npx @music163/ncm-cli play --song --encrypted-id "${encryptedId}" --original-id "${originalId}" --output json`, {
    timeout: 30000,
    env: { ...process.env, PATH: `${mpvPath};${process.env.PATH || ''}` },
  }, (err, stdout) => {
    if (err?.killed) {
      // OK — long-running play, daemon/mpv continue independently
    }
  });
}

/** Get encrypted ID of the user's liked-songs playlist (specialType 5) */
async function getLikedPlaylistEncId(): Promise<string | null> {
  const raw = await ncmExec('playlist created');
  const data = tryParse(raw);
  const records = data?.data?.records || [];
  const liked = records.find((r: any) => r.specialType === 5);
  return liked?.id || null;
}

/** Get playable tracks from a playlist with random offset for variety */
async function getPlaylistSongs(encId: string, limit = 50): Promise<any[]> {
  const offset = Math.floor(Math.random() * 200);
  const raw = await ncmExec(`playlist tracks --playlistId ${encId} --limit ${limit} --offset ${offset}`);
  const data = tryParse(raw);
  const tracks = data?.data || [];
  return tracks.filter((s: any) => s.playFlag !== false);
}

/** Check if user is asking for their liked/favorited songs */
function isLikedSongsRequest(text: string): boolean {
  return /我喜欢的|我的喜欢|喜欢的歌|喜欢的音乐|红心|收藏的歌/.test(text);
}

/** Check if user is asking for daily recommendations */
function isRecommendRequest(text: string): boolean {
  return /推荐|每日|今天听什么|有什么新歌|推荐.*歌|今日推荐|日推/.test(text);
}

/** Get playable songs from daily recommend */
async function getDailySongs(limit = 30): Promise<any[]> {
  const raw = await ncmExec(`recommend daily --limit ${limit}`);
  const data = tryParse(raw);
  const tracks = data?.data || [];
  return tracks.filter((s: any) => s.playFlag !== false);
}

function extractTarget(userText: string): string | null {
  let t = userText.replace(/[。！？，\s]+/g, ' ').trim();
  const prefixWords = /^(给我|帮我|我想|我要|来|放|播放|搜|听|来点|随便放|随便来|一首|一个|点|下|一下|首|的)\s*/;
  const suffixWords = /\s*(歌|歌曲|音乐|的歌|的歌曲|的音乐|的歌单|吧|啊|呢|哦|哈|呀)$/;
  let changed = true;
  while (changed) {
    changed = false;
    const before = t;
    t = t.replace(prefixWords, '').replace(suffixWords, '');
    if (t !== before) changed = true;
  }
  t = t.trim();
  if (!t || /^(歌|音乐|首|点|下|一个|一首|一下|随便|推荐|热门|好听)$/.test(t)) return null;
  return t.length > 0 && t.length <= 30 ? t : null;
}

async function pickAndPlay(
  socket: any, userId: string, mood: string,
  candidates: any[], source: string,
): Promise<{ success: boolean; text?: string }> {
  const playable = candidates.filter((s: any) => s.playFlag !== false);
  if (playable.length === 0) return { success: false };
  console.log(`[Music] ${source}: ${playable.length} playable from ${candidates.length} candidates`);

  const pick = playable[Math.floor(Math.random() * playable.length)];
  const trackInfo = {
    name: pick.name,
    artists: (pick.artists || pick.fullArtists || []).map((a: any) => a.name),
    album: pick.album?.name,
    duration: pick.duration,
    coverUrl: pick.coverImgUrl,
  };

  ncmFirePlay(pick.id, pick.originalId);
  console.log(`[Music] Selected: "${trackInfo.name}"`);

  const emotionalState = loadEmotionalState(userId);

  // Lyrics via ncm-cli (authenticated)
  let lyricsData: any[] = [];
  try {
    const lyricRaw = await ncmExec(`song lyric --songId ${pick.id}`, 10000);
    const lyricJson = tryParse(lyricRaw);
    const lrcText = lyricJson?.data?.lyric || '';
    for (const line of lrcText.split('\n')) {
      const m = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/);
      if (m) {
        const time = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / (m[3].length === 3 ? 1000 : 100);
        const text = m[4].trim();
        if (text) lyricsData.push({ time, text });
      }
    }
  } catch {}

  // Scene
  let scene: MusicScene = getFallbackScene(mood, { valence: emotionalState.valence, arousal: emotionalState.arousal });
  try {
    const { generateMusicScene } = await import('../music/scene_generator');
    const llmScene = await generateMusicScene(userId, trackInfo, mood);
    if (llmScene) scene = llmScene;
  } catch {}

  const reasonPhrase = moodReasonMap[mood] || '根据你现在的状态';
  const lumiReason = `${reasonPhrase}，给你放一首「${trackInfo.name}」，希望你喜欢。`;

  console.log(`[Music] Scene: ${scene.scene}, particles=${scene.particles}`);
  emitMusicAtmosphere(socket, {
    track: trackInfo, mood, audioUrl: '',
    lyrics: lyricsData, lumiReason, scene,
  });

  return { success: true, text: lumiReason };
}

export async function searchAndPlay(
  userId: string,
  socket: any,
  userText?: string,
): Promise<{ success: boolean; text?: string }> {
  const emotionalState = loadEmotionalState(userId);
  const mood = emotionalState.dominantMood || 'peaceful';

  // 1. "我喜欢的歌" / "放红心歌单" → liked playlist
  if (userText && isLikedSongsRequest(userText)) {
    const encId = await getLikedPlaylistEncId();
    if (encId) {
      const songs = await getPlaylistSongs(encId);
      if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'liked');
    }
    return { success: false };
  }

  // 2. "每日推荐" / "有什么新歌" → daily recommend
  if (userText && isRecommendRequest(userText)) {
    const songs = await getDailySongs(30);
    if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'daily');
    return { success: false };
  }

  // 3. Specific artist/song request → search
  if (userText) {
    const target = extractTarget(userText);
    if (target) {
      console.log(`[Music] User target: "${target}"`);
      const searchRaw = await ncmExec(`search song --keyword "${target}" --limit 5`);
      const searchData = tryParse(searchRaw);
      const songs = searchData?.data?.records || [];
      if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'search');
    }
  }

  // 4. Default: liked playlist preferred, fallback to mood search
  const encId = await getLikedPlaylistEncId();
  if (encId) {
    const songs = await getPlaylistSongs(encId, 30);
    if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'liked');
  }

  // Fallback: mood-based search
  const keyword = moodSearchMap[mood] || '推荐 热门';
  const searchRaw = await ncmExec(`search song --keyword "${keyword}" --limit 5`);
  const searchData = tryParse(searchRaw);
  const songs = searchData?.data?.records || [];
  if (songs.length > 0) return pickAndPlay(socket, userId, mood, songs, 'search');

  return { success: false };
}
