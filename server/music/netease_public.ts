type NeteaseArtist = { id?: number | string; name?: string };

export interface PublicNeteaseSong {
  id: string;
  originalId: string;
  name: string;
  artists: string[];
  album?: { name?: string; picUrl?: string };
  duration?: number;
  coverImgUrl?: string;
  playFlag?: boolean;
}

const MUSIC_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 LumiOS/1.0',
  Referer: 'https://music.163.com/',
  Accept: 'application/json',
};

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortController === 'undefined') return undefined;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

async function fetchJson(url: string, timeout = 12000): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: MUSIC_HEADERS,
      signal: timeoutSignal(timeout),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeArtists(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((artist: any) => typeof artist === 'string' ? artist : (artist as NeteaseArtist)?.name)
    .filter(Boolean);
}

function normalizePublicSong(song: any): PublicNeteaseSong | null {
  const id = String(song?.id || song?.songId || '').trim();
  if (!id) return null;
  const album = song?.album || song?.al || {};
  return {
    id,
    originalId: id,
    name: String(song?.name || song?.title || 'Unknown track'),
    artists: normalizeArtists(song?.artists || song?.ar || song?.artist),
    album: {
      name: album?.name,
      picUrl: album?.picUrl || album?.blurPicUrl,
    },
    duration: Number(song?.duration || song?.dt || 0),
    coverImgUrl: song?.coverImgUrl || album?.picUrl || album?.blurPicUrl,
    playFlag: song?.playFlag !== false,
  };
}

export function normalizePublicSongs(songs: any[]): PublicNeteaseSong[] {
  return (Array.isArray(songs) ? songs : [])
    .map(normalizePublicSong)
    .filter(Boolean) as PublicNeteaseSong[];
}

export async function searchNeteaseSongs(keyword: string, limit = 20): Promise<PublicNeteaseSong[]> {
  const q = String(keyword || '').trim();
  if (!q) return [];
  const max = Math.max(1, Math.min(Number(limit) || 20, 50));
  const data = await fetchJson(
    `https://music.163.com/api/search/get/web?csrf_token=&hlpretag=&hlposttag=&s=${encodeURIComponent(q)}&type=1&limit=${max}&offset=0&total=true`,
  );
  if (!data || data.code !== 200) return [];
  return normalizePublicSongs(data?.result?.songs || []);
}

export async function getNeteaseLyricText(songId: string): Promise<string> {
  const id = String(songId || '').trim();
  if (!/^\d+$/.test(id)) return '';
  const data = await fetchJson(`https://music.163.com/api/song/lyric?os=pc&id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`, 10000);
  return String(data?.lrc?.lyric || '');
}

export async function getNeteasePlaylistSongs(playlistId: string, limit = 100): Promise<PublicNeteaseSong[]> {
  const id = String(playlistId || '').trim();
  if (!id) return [];
  const max = Math.max(1, Math.min(Number(limit) || 100, 1000));
  const data = await fetchJson(`https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(id)}&n=${max}&s=0`, 15000);
  const tracks = data?.playlist?.tracks || data?.result?.tracks || [];
  return normalizePublicSongs(tracks);
}
