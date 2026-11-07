export type Platform = 'youtube' | 'instagram'

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
])

const IG_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
  'instagr.am',
  'www.instagr.am',
])

export function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('URL is required')
  let candidate = trimmed
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error('Invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed')
  }
  return url
}

export function detectPlatform(url: URL): Platform | null {
  const host = url.hostname.toLowerCase()
  if (YT_HOSTS.has(host) || host.endsWith('.youtube.com')) return 'youtube'
  if (IG_HOSTS.has(host) || host.endsWith('.instagram.com')) return 'instagram'
  return null
}

export function assertAllowedMediaUrl(raw: string): URL {
  const url = normalizeUrl(raw)
  const host = url.hostname.toLowerCase()
  const ok =
    host.includes('googlevideo.com') ||
    host.includes('youtube.com') ||
    host.includes('ytimg.com') ||
    host.includes('ggpht.com') ||
    host.includes('instagram.com') ||
    host.includes('cdninstagram.com') ||
    host.includes('fbcdn.net') ||
    host.includes('fbsbx.com')
  if (!ok) throw new Error('Media host not allowed')
  return url
}

export function extractYoutubeId(url: URL): string | null {
  if (url.hostname.includes('youtu.be')) {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id || null
  }
  const v = url.searchParams.get('v')
  if (v) return v
  const parts = url.pathname.split('/').filter(Boolean)
  const marker = parts.findIndex((p) => p === 'shorts' || p === 'embed' || p === 'live')
  if (marker >= 0 && parts[marker + 1]) return parts[marker + 1]
  return null
}

export function isInstagramStory(url: URL): boolean {
  return /\/stories?\//i.test(url.pathname)
}

export function formatDuration(seconds: number | undefined | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

export function sanitizeFilename(name: string, fallback = 'wavey'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- strip control chars from filenames
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return cleaned || fallback
}

/** ASCII-only name safe for Node HTTP header values. */
export function asciiFilename(name: string, fallback = 'wavey.bin'): string {
  const base = sanitizeFilename(name, fallback)
  const ascii = base
    .normalize('NFKD')
    // eslint-disable-next-line no-control-regex -- header values must be ASCII
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/["\\;]/g, '_')
    .trim()
  return ascii || fallback
}

/** RFC 5987 Content-Disposition — avoids "Invalid character in header content". */
export function contentDispositionAttachment(filename: string): string {
  const raw = sanitizeFilename(filename, 'wavey.bin')
  const ascii = asciiFilename(raw)
  const starred = encodeURIComponent(raw).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${starred}`
}
