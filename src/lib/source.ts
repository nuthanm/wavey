export function detectSource(url: string): 'youtube' | 'instagram' | 'unknown' {
  const u = url.toLowerCase()
  if (/youtu\.be|youtube\.com|music\.youtube/.test(u)) return 'youtube'
  if (/instagram\.com|instagr\.am/.test(u)) return 'instagram'
  return 'unknown'
}

export function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.split('/').filter(Boolean)[0]
      return id || null
    }
    const v = u.searchParams.get('v')
    if (v) return v
    const parts = u.pathname.split('/').filter(Boolean)
    const marker = parts.findIndex((p) => p === 'shorts' || p === 'embed' || p === 'live')
    if (marker >= 0 && parts[marker + 1]) return parts[marker + 1]
    return null
  } catch {
    const m = url.match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{6,})/)
    return m?.[1] ?? null
  }
}
