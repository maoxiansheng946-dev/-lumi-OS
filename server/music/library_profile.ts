import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDataPath } from '../config/data_path';

export interface MusicCountItem {
  name: string;
  count: number;
  ratio: number;
}

export interface MusicLibraryTrack {
  id: string;
  name: string;
  artists: string[];
  album?: string;
  duration?: number;
  coverUrl?: string;
  publishYear?: number;
}

export interface MusicPreferenceProfile {
  userId: string;
  source: 'netease-liked';
  playlistId: string;
  playlistName: string;
  totalTracks: number;
  analyzedTracks: number;
  scannedPages: number;
  updatedAt: string;
  topArtists: MusicCountItem[];
  topAlbums: MusicCountItem[];
  languageMix: MusicCountItem[];
  moodMix: MusicCountItem[];
  styleMix: MusicCountItem[];
  durationMix: MusicCountItem[];
  decadeMix: MusicCountItem[];
  sampleTracks: MusicLibraryTrack[];
  insights: string[];
  recommendationHints: string[];
  summaryCn: string;
  promptSummary: string;
}

interface LikedPlaylistInfo {
  id: string;
  name: string;
  trackCount: number;
}

function quoteCmdArg(value: string): string {
  const raw = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '\\"').replace(/([&|<>^%])/g, '^$1')}"`;
}

function runNcmCli(args: string[], timeout = 25000): Promise<string> {
  return new Promise((resolve) => {
    const finish = (err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
      const out = stdout?.toString() || '';
      if (err && !out) {
        console.warn('[MusicProfile] ncm-cli error:', stderr?.toString() || err.message);
        resolve('');
        return;
      }
      resolve(out);
    };

    if (process.platform === 'win32') {
      const cmdline = ['npx.cmd', '@music163/ncm-cli', ...args, '--output', 'json']
        .map(quoteCmdArg)
        .join(' ');
      execFile('cmd.exe', ['/d', '/c', cmdline], {
        timeout,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      }, finish);
      return;
    }

    execFile('npx', ['@music163/ncm-cli', ...args, '--output', 'json'], {
      timeout,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    }, finish);
  });
}

function tryParse(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

function extractRecords(data: any): any[] {
  const records = data?.data?.records || data?.data?.songs || data?.result?.songs || data?.songs || data?.data || [];
  return Array.isArray(records) ? records : [];
}

function safeUserId(userId: string): string {
  return (userId || 'anonymous').replace(/[^A-Za-z0-9_.-]/g, '_');
}

function profilePath(userId: string): string {
  return getDataPath(path.join('music', `profile_${safeUserId(userId)}.json`));
}

function getSongIds(song: any): { id: string; originalId: string } {
  const id = String(song?.id || song?.encryptedId || song?.songId || '').trim();
  const originalId = String(song?.originalId || song?.originId || song?.songId || (/^\d+$/.test(id) ? id : '')).trim();
  return { id, originalId };
}

function normalizeArtists(song: any): string[] {
  const raw = song?.artists || song?.fullArtists || song?.ar || song?.artist || [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((artist: any) => typeof artist === 'string' ? artist : artist?.name)
    .filter(Boolean);
}

function normalizeYear(song: any): number | undefined {
  const raw = song?.publishTime || song?.publishTimeMs || song?.year || song?.album?.publishTime || song?.al?.publishTime;
  const num = Number(raw || 0);
  if (!num) return undefined;
  if (num > 1900 && num < 2200) return num;
  const year = new Date(num).getFullYear();
  return Number.isFinite(year) && year > 1900 && year < 2200 ? year : undefined;
}

function normalizeTrack(song: any): MusicLibraryTrack {
  const ids = getSongIds(song);
  return {
    id: ids.originalId || ids.id || `${song?.name || song?.title || 'track'}:${normalizeArtists(song).join(',')}`,
    name: song?.name || song?.title || 'Unknown track',
    artists: normalizeArtists(song),
    album: song?.album?.name || song?.al?.name,
    duration: Number(song?.duration || song?.dt || 0),
    coverUrl: song?.coverImgUrl || song?.album?.picUrl || song?.al?.picUrl,
    publishYear: normalizeYear(song),
  };
}

async function getLikedPlaylistInfo(): Promise<LikedPlaylistInfo | null> {
  const raw = await runNcmCli(['playlist', 'created']);
  const data = tryParse(raw);
  const records = extractRecords(data);
  const liked = records.find((r: any) => r?.specialType === 5)
    || records.find((r: any) => /我喜欢|喜欢的音乐|Liked Songs|Favorites/i.test(String(r?.name || r?.title || '')));
  if (!liked?.id) return null;
  return {
    id: String(liked.id),
    name: String(liked.name || liked.title || '我喜欢的音乐'),
    trackCount: Number(liked.trackCount || liked.songCount || liked.musicSize || liked.size || 0),
  };
}

async function getPlaylistTracksPage(playlistId: string, limit: number, offset: number): Promise<any[]> {
  const raw = await runNcmCli([
    'playlist',
    'tracks',
    '--playlistId',
    playlistId,
    '--limit',
    String(limit),
    '--offset',
    String(offset),
  ]);
  const data = tryParse(raw);
  return extractRecords(data).filter((song: any) => song?.playFlag !== false);
}

function addCount(map: Map<string, number>, key?: string) {
  const normalized = String(key || '').trim();
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function topCounts(map: Map<string, number>, total: number, limit = 8): MusicCountItem[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count, ratio: total > 0 ? count / total : 0 }));
}

function inferLanguage(track: MusicLibraryTrack): string {
  const text = `${track.name} ${track.artists.join(' ')} ${track.album || ''}`;
  if (/[\u3040-\u30ff]/.test(text)) return '日语/ACG';
  if (/[\uac00-\ud7af]/.test(text)) return '韩语';
  if (/[\u4e00-\u9fff]/.test(text)) return '中文';
  if (/[A-Za-z]/.test(text)) return '英语/欧美';
  return '其他';
}

function inferDuration(track: MusicLibraryTrack): string {
  const seconds = (track.duration || 0) / 1000;
  if (!seconds) return '未知时长';
  if (seconds < 120) return '短歌';
  if (seconds < 240) return '标准流行';
  if (seconds < 360) return '长段落';
  return '沉浸长曲';
}

function inferDecade(track: MusicLibraryTrack): string {
  if (!track.publishYear) return '未知年代';
  const decade = Math.floor(track.publishYear / 10) * 10;
  return `${decade}s`;
}

function inferMood(track: MusicLibraryTrack): string {
  const text = `${track.name} ${track.album || ''}`.toLowerCase();
  if (/(伤|泪|痛|sad|blue|alone|lonely|失恋|遗憾|心碎|雨一直)/i.test(text)) return '伤感/低落';
  if (/(夜|月|星|梦|安静|寂静|sleep|calm|piano|lofi|晚安|温柔)/i.test(text)) return '安静/治愈';
  if (/(爱|恋|吻|heart|love|romance|喜欢你|告白)/i.test(text)) return '浪漫/亲密';
  if (/(燃|热|光|run|dance|party|rock|fire|自由|夏天)/i.test(text)) return '明亮/高能';
  if (/(旧|回忆|怀念|从前|yesterday|memory|岁月)/i.test(text)) return '怀旧/回望';
  if (/(intro|纯音乐|钢琴|ambient|study|focus|冥想)/i.test(text)) return '专注/背景';
  return '日常陪伴';
}

function inferStyle(track: MusicLibraryTrack): string {
  const text = `${track.name} ${track.album || ''} ${track.artists.join(' ')}`.toLowerCase();
  if (/(ost|原声|soundtrack|影视|电影|剧集|anime|acg|op|ed)/i.test(text)) return 'OST/ACG';
  if (/(rock|摇滚|punk|metal|band|乐队)/i.test(text)) return '摇滚/乐队';
  if (/(folk|民谣|吉他|acoustic)/i.test(text)) return '民谣/原声';
  if (/(rap|hip.?hop|说唱|嘻哈)/i.test(text)) return '说唱/节奏';
  if (/(electronic|edm|dj|remix|house|techno|电子)/i.test(text)) return '电子/律动';
  if (/(jazz|爵士|soul|r&b|blues)/i.test(text)) return 'R&B/Jazz';
  if (/(classical|古典|钢琴|piano|violin|cello|交响)/i.test(text)) return '古典/器乐';
  return '流行/综合';
}

function buildInsights(profile: Omit<MusicPreferenceProfile, 'insights' | 'recommendationHints' | 'summaryCn' | 'promptSummary'>): Pick<MusicPreferenceProfile, 'insights' | 'recommendationHints' | 'summaryCn' | 'promptSummary'> {
  const artist = profile.topArtists[0]?.name || '多个歌手';
  const mood = profile.moodMix[0]?.name || '日常陪伴';
  const lang = profile.languageMix[0]?.name || '多语种';
  const style = profile.styleMix[0]?.name || '综合风格';
  const duration = profile.durationMix[0]?.name || '标准流行';
  const total = profile.analyzedTracks;
  const insights = [
    `你的喜欢歌单里最突出的歌手是 ${artist}，说明你的听歌偏好不是完全随机的，而是会围绕熟悉声音形成稳定区域。`,
    `整体情绪更偏向 ${mood}，Lumi 推荐音乐时应该先考虑当下状态，再在这个情绪底色里选歌。`,
    `语种/来源上 ${lang} 占比最高，风格上 ${style} 更突出。`,
    `歌曲长度以 ${duration} 为主，适合用作日常陪伴和工作间隙的连续播放。`,
  ];
  const recommendationHints = [
    `播放喜欢歌单时优先覆盖 ${profile.topArtists.slice(0, 5).map(i => i.name).join('、') || '高频歌手'}。`,
    `心情低落或深夜时优先选择 ${profile.moodMix.slice(0, 3).map(i => i.name).join('、') || '安静曲目'}。`,
    `专注工作时从 ${profile.styleMix.slice(0, 3).map(i => i.name).join('、') || '轻背景曲目'} 中挑选，减少强打断感。`,
  ];
  const summaryCn = `已分析你网易云喜欢歌单中的 ${total} 首歌：高频歌手是 ${artist}，主情绪偏 ${mood}，主要语种/来源是 ${lang}，代表风格是 ${style}。`;
  const promptSummary = `User's NetEase liked-music profile: ${total} analyzed tracks; top artists=${profile.topArtists.slice(0, 5).map(i => `${i.name}(${i.count})`).join(', ') || 'unknown'}; dominant mood=${mood}; language=${lang}; style=${style}; duration=${duration}. Use this when recommending music or discussing the user's musical taste.`;
  return { insights, recommendationHints, summaryCn, promptSummary };
}

function buildProfile(userId: string, playlist: LikedPlaylistInfo, tracks: MusicLibraryTrack[], scannedPages: number): MusicPreferenceProfile {
  const total = tracks.length;
  const artists = new Map<string, number>();
  const albums = new Map<string, number>();
  const languages = new Map<string, number>();
  const moods = new Map<string, number>();
  const styles = new Map<string, number>();
  const durations = new Map<string, number>();
  const decades = new Map<string, number>();

  for (const track of tracks) {
    for (const artist of track.artists) addCount(artists, artist);
    addCount(albums, track.album);
    addCount(languages, inferLanguage(track));
    addCount(moods, inferMood(track));
    addCount(styles, inferStyle(track));
    addCount(durations, inferDuration(track));
    addCount(decades, inferDecade(track));
  }

  const base = {
    userId,
    source: 'netease-liked' as const,
    playlistId: playlist.id,
    playlistName: playlist.name,
    totalTracks: playlist.trackCount || total,
    analyzedTracks: total,
    scannedPages,
    updatedAt: new Date().toISOString(),
    topArtists: topCounts(artists, total, 10),
    topAlbums: topCounts(albums, total, 8),
    languageMix: topCounts(languages, total, 6),
    moodMix: topCounts(moods, total, 8),
    styleMix: topCounts(styles, total, 8),
    durationMix: topCounts(durations, total, 6),
    decadeMix: topCounts(decades, total, 8),
    sampleTracks: tracks.slice(0, 12),
  };

  return { ...base, ...buildInsights(base) };
}

export function getCachedMusicProfile(userId: string): MusicPreferenceProfile | null {
  try {
    const file = profilePath(userId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as MusicPreferenceProfile;
  } catch {
    return null;
  }
}

function saveMusicProfile(profile: MusicPreferenceProfile): void {
  const file = profilePath(profile.userId);
  fs.writeFileSync(file, JSON.stringify(profile, null, 2), 'utf8');
}

export async function analyzeLikedMusicProfile(userId: string, options: { maxSongs?: number } = {}): Promise<MusicPreferenceProfile> {
  const playlist = await getLikedPlaylistInfo();
  if (!playlist) {
    throw new Error('没有读取到网易云喜欢歌单，请先在音乐中心完成网易云登录。');
  }

  const pageSize = 100;
  const maxSongs = Math.max(100, Math.min(Number(options.maxSongs || 3000), 5000));
  const targetTotal = playlist.trackCount > 0 ? Math.min(playlist.trackCount, maxSongs) : maxSongs;
  const tracks: MusicLibraryTrack[] = [];
  const seen = new Set<string>();
  let scannedPages = 0;
  let emptyPages = 0;

  for (let offset = 0; offset < targetTotal; offset += pageSize) {
    const page = await getPlaylistTracksPage(playlist.id, pageSize, offset);
    scannedPages += 1;
    if (!page.length) {
      emptyPages += 1;
      if (emptyPages >= 3) break;
      continue;
    }
    emptyPages = 0;
    for (const raw of page) {
      const track = normalizeTrack(raw);
      const key = track.id || `${track.name}:${track.artists.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(track);
      if (tracks.length >= targetTotal) break;
    }
    if (tracks.length >= targetTotal) break;
  }

  if (!tracks.length) {
    throw new Error('喜欢歌单读取成功，但没有拿到可分析的歌曲。');
  }

  const profile = buildProfile(userId, playlist, tracks, scannedPages);
  saveMusicProfile(profile);
  return profile;
}

export function formatMusicProfileForPrompt(profile: MusicPreferenceProfile | null): string {
  if (!profile) return 'not analyzed yet';
  return profile.promptSummary;
}

export function formatMusicProfileReport(profile: MusicPreferenceProfile): string {
  const artists = profile.topArtists.slice(0, 6).map(i => `${i.name} ${i.count}`).join('，') || '暂无';
  const moods = profile.moodMix.slice(0, 5).map(i => `${i.name} ${Math.round(i.ratio * 100)}%`).join('，') || '暂无';
  const styles = profile.styleMix.slice(0, 5).map(i => `${i.name} ${Math.round(i.ratio * 100)}%`).join('，') || '暂无';
  return [
    profile.summaryCn,
    '',
    `高频歌手：${artists}`,
    `情绪分布：${moods}`,
    `风格分布：${styles}`,
    '',
    '我的判断：',
    ...profile.insights.map(item => `- ${item}`),
    '',
    '之后我给你放歌时会参考这份画像，不只随机挑歌。',
  ].join('\n');
}

export function isMusicProfileAnalysisRequest(text?: string): boolean {
  const normalized = (text || '').trim();
  if (!normalized) return false;
  const wantsAnalysis = /(分析|画像|品味|偏好|总结|看看|了解|解读|报告|统计)/u.test(normalized);
  const aboutMusic = /(歌单|喜欢的歌|红心|收藏|音乐|网易云|听歌)/u.test(normalized);
  return wantsAnalysis && aboutMusic;
}
