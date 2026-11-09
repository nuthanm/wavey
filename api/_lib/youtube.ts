import { Innertube, UniversalCache } from 'youtubei.js'
import { extractYoutubeId, formatDuration, sanitizeFilename } from './validate.js'
import { getYtCookie } from './ytCookie.js'

export type ResolvedMedia = {
  platform: 'youtube'
  title: string
  creator: string
  duration: string
  durationSec: number
  thumbUrl: string | null
  thumbHue: number
  kindLabel: string
  sourceUrl: string
  videoId: string
}

export type PickedFormat = {
  mediaUrl: string
  mimeType: string
  kind: 'audio' | 'video'
  quality: number
  filename: string
  contentLength?: number
}

export type YoutubeDelivery =
  | {
      mode: 'single'
      kind: 'audio' | 'video'
      mediaUrl: string
      mimeType: string
      filename: string
      quality: number
      title: string
      needsMux: false
      availableHeights: number[]
    }
  | {
      mode: 'adaptive'
      kind: 'video'
      videoUrl: string
      audioUrl: string
      videoMime: string
      audioMime: string
      filename: string
      quality: number
      title: string
      needsMux: true
      availableHeights: number[]
    }

type YtInfo = Awaited<ReturnType<typeof getInfo>>

let innertubePromise: Promise<Innertube> | null = null

function resetTube() {
  innertubePromise = null
}

async function getTube(): Promise<Innertube> {
  if (!innertubePromise) {
    const cookie = getYtCookie()
    innertubePromise = Innertube.create({
      cache: new UniversalCache(false),
      retrieve_player: true,
      cookie,
      // Keep Origin consistent so SAPISIDHASH auth is accepted
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
        if (cookie && !headers.has('Cookie')) headers.set('Cookie', cookie)
        if (!headers.has('Origin')) headers.set('Origin', 'https://www.youtube.com')
        if (!headers.has('Referer')) headers.set('Referer', 'https://www.youtube.com/')
        return fetch(input, { ...init, headers })
      },
    }).catch((err) => {
      innertubePromise = null
      throw err
    })
  }
  return innertubePromise
}

function pickThumb(info: {
  basic_info?: {
    thumbnail?: Array<{ url: string }> | null
    id?: string | null
  }
}): string | null {
  const list = info.basic_info?.thumbnail
  if (list?.length) return list[list.length - 1]!.url
  const id = info.basic_info?.id
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
}

/** Anonymous clients that sometimes unlock age gates without a cookie. */
const ANON_CLIENTS = [
  'TV_EMBEDDED',
  'TV',
  'ANDROID_VR',
  'ANDROID',
  'IOS',
  'WEB_EMBEDDED',
  'MWEB',
  'WEB',
] as const

/** With a logged-in cookie, prefer WEB so SAPISIDHASH auth is applied. */
const AUTH_CLIENTS = [
  'WEB',
  'MWEB',
  'TV_EMBEDDED',
  'TV',
  'ANDROID',
  'IOS',
  'WEB_EMBEDDED',
  'ANDROID_VR',
] as const

function clientLadder() {
  return getYtCookie() ? AUTH_CLIENTS : ANON_CLIENTS
}

function playabilityOk(info: {
  playability_status?: { status?: string | null; reason?: string | null } | null
  streaming_data?: { formats?: unknown[]; adaptive_formats?: unknown[] } | null
}): boolean {
  const status = info.playability_status?.status
  if (!status || status === 'OK') return true
  const formats = info.streaming_data?.formats?.length || 0
  const adaptive = info.streaming_data?.adaptive_formats?.length || 0
  // Some clients return LOGIN_REQUIRED but still attach streams
  return formats + adaptive > 0
}

function isAgeOrLoginGate(msg: string): boolean {
  return /age|confirm your age|sign in to confirm|login_required|login required/i.test(msg)
}

async function getInfo(videoId: string) {
  let lastErr: unknown
  let ageGateReason: string | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    const tube = await getTube()
    for (const client of clientLadder()) {
      try {
        const info = await tube.getBasicInfo(videoId, { client })
        if (playabilityOk(info)) return info

        const reason =
          info.playability_status?.reason ||
          info.playability_status?.status ||
          'Video is not playable'
        if (isAgeOrLoginGate(String(reason))) {
          ageGateReason = String(reason)
          lastErr = new Error(reason)
          continue
        }
        lastErr = new Error(reason)
      } catch (err) {
        lastErr = err
        const msg = err instanceof Error ? err.message : String(err)
        if (isAgeOrLoginGate(msg)) ageGateReason = msg
        if (/non 2xx|fetch_failed/i.test(msg)) resetTube()
      }
    }
    resetTube()
  }

  if (ageGateReason) {
    const hasCookie = Boolean(getYtCookie())
    throw new Error(
      hasCookie
        ? `Age-restricted video still blocked (cookie may be stale): ${ageGateReason}`
        : `Age-restricted — YouTube requires a signed-in session for this video (${ageGateReason})`,
    )
  }

  throw lastErr instanceof Error ? lastErr : new Error('Failed to load YouTube info')
}

export async function resolveYoutube(sourceUrl: string): Promise<ResolvedMedia> {
  const url = new URL(sourceUrl)
  const videoId = extractYoutubeId(url)
  if (!videoId) throw new Error('Could not parse YouTube video id')

  const info = await getInfo(videoId)
  if (!playabilityOk(info)) {
    const reason = info.playability_status?.reason || info.playability_status?.status || 'Video is not playable'
    if (isAgeOrLoginGate(String(reason))) {
      const hasCookie = Boolean(getYtCookie())
      throw new Error(
        hasCookie
          ? `Age-restricted video still blocked (cookie may be stale): ${reason}`
          : `Age-restricted — YouTube requires a signed-in session for this video (${reason})`,
      )
    }
    throw new Error(String(reason))
  }

  const title = info.basic_info.title || 'YouTube video'
  const creator = info.basic_info.author || 'YouTube'
  const durationSec = info.basic_info.duration ?? 0
  const path = url.pathname.toLowerCase()

  return {
    platform: 'youtube',
    title,
    creator: creator.startsWith('@') ? creator : `@${creator.replace(/\s+/g, '')}`,
    duration: formatDuration(durationSec),
    durationSec,
    thumbUrl: pickThumb(info),
    thumbHue: 48,
    kindLabel: path.includes('shorts') ? 'Shorts' : 'YouTube',
    sourceUrl,
    videoId,
  }
}

export function youtubeOutputHints(
  meta: ResolvedMedia,
  opts: { kind: 'audio' | 'video'; quality: number },
): { mimeType: string; filename: string; needsEncode: boolean; needsMux: boolean } {
  const base = sanitizeFilename(meta.title)
  if (opts.kind === 'audio') {
    return {
      mimeType: 'audio/mp4',
      filename: `${base}.m4a`,
      needsEncode: true,
      needsMux: false,
    }
  }
  return {
    mimeType: 'video/mp4',
    filename: `${base}.mp4`,
    needsEncode: false,
    // High-res YouTube is almost always adaptive (separate A/V)
    needsMux: opts.quality > 720,
  }
}

function videoQualityLabel(height: number): string {
  if (height >= 2160) return '2160p'
  if (height >= 1440) return '1440p'
  if (height >= 1080) return '1080p'
  if (height >= 720) return '720p'
  if (height >= 480) return '480p'
  if (height >= 360) return '360p'
  return '240p'
}

function videoQualityFallbacks(height: number): string[] {
  const label = videoQualityLabel(height)
  const ladder = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p']
  const idx = ladder.indexOf(label)
  const fromRequested = idx >= 0 ? ladder.slice(idx) : ladder.slice(2)
  return [...fromRequested, 'best', 'bestefficiency']
}

export function listAvailableHeights(info: YtInfo): number[] {
  const heights = new Set<number>()
  const formats = [
    ...(info.streaming_data?.formats || []),
    ...(info.streaming_data?.adaptive_formats || []),
  ]
  for (const f of formats) {
    const h = typeof f.height === 'number' ? f.height : 0
    if (h > 0) heights.add(h)
  }
  return [...heights].sort((a, b) => b - a)
}

async function decipherUrl(
  // youtubei.js Format.decipher player typing changes across versions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  format: { url?: string | null; decipher: (player?: any) => Promise<string> },
  info: YtInfo,
): Promise<string> {
  let mediaUrl = format.url || ''
  if (!mediaUrl) {
    try {
      mediaUrl = await format.decipher(info.actions.session.player)
    } catch {
      mediaUrl = ''
    }
  }
  if (!mediaUrl) {
    throw new Error('No valid URL to decipher — try again')
  }
  return mediaUrl
}

function mimeOf(format: { mime_type?: string }): string {
  return (format.mime_type || '').split(';')[0]!.trim().toLowerCase()
}

function chooseAudioFormat(info: YtInfo) {
  const attempts: Array<{ format: string; quality: string }> = [
    { format: 'mp4', quality: 'best' },
    { format: 'any', quality: 'best' },
    { format: 'any', quality: 'bestefficiency' },
  ]
  let lastErr: unknown
  for (const opts of attempts) {
    try {
      const format = info.chooseFormat({
        type: 'audio',
        quality: opts.quality,
        format: opts.format,
      })
      const mime = mimeOf(format)
      if (mime.startsWith('video/')) {
        lastErr = new Error('Got video container for audio request')
        continue
      }
      return format
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('No audio formats available')
}

function chooseProgressiveFormat(info: YtInfo, height: number) {
  let lastErr: unknown
  for (const quality of videoQualityFallbacks(Math.min(height, 720))) {
    try {
      const format = info.chooseFormat({
        type: 'video+audio',
        quality,
        format: 'any',
      })
      const mime = mimeOf(format)
      if (mime.startsWith('audio/')) {
        lastErr = new Error('audio-only format')
        continue
      }
      // Prefer streams that actually include audio when the flag is present
      if ('has_audio' in format && (format as { has_audio?: boolean }).has_audio === false) {
        lastErr = new Error('progressive without audio')
        continue
      }
      return format
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('No progressive video+audio format')
}

function chooseAdaptiveVideoFormat(info: YtInfo, height: number) {
  const containers = ['mp4', 'any'] as const
  let lastErr: unknown
  for (const quality of videoQualityFallbacks(height)) {
    for (const container of containers) {
      try {
        const format = info.chooseFormat({
          type: 'video',
          quality,
          format: container,
        })
        const mime = mimeOf(format)
        if (mime.startsWith('audio/')) continue
        return format
      } catch (err) {
        lastErr = err
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('No adaptive video formats')
}

export async function pickYoutubeFormat(
  sourceUrl: string,
  opts: { kind: 'audio' | 'video'; quality: number },
): Promise<PickedFormat & { title: string }> {
  const delivery = await pickYoutubeDelivery(sourceUrl, opts)
  if (delivery.mode === 'adaptive') {
    // Caller asked for a single URL — return the video leg (mux happens client-side)
    return {
      mediaUrl: delivery.videoUrl,
      mimeType: delivery.videoMime,
      kind: 'video',
      quality: delivery.quality,
      filename: delivery.filename,
      title: delivery.title,
    }
  }
  return {
    mediaUrl: delivery.mediaUrl,
    mimeType: delivery.mimeType,
    kind: delivery.kind,
    quality: delivery.quality,
    filename: delivery.filename,
    title: delivery.title,
  }
}

export async function pickYoutubeDelivery(
  sourceUrl: string,
  opts: { kind: 'audio' | 'video'; quality: number },
): Promise<YoutubeDelivery> {
  const meta = await resolveYoutube(sourceUrl)
  const info = await getInfo(meta.videoId)
  const availableHeights = listAvailableHeights(info)
  const base = sanitizeFilename(meta.title)

  if (opts.kind === 'audio') {
    const format = chooseAudioFormat(info)
    const mediaUrl = await decipherUrl(format, info)
    const mime = mimeOf(format) || 'audio/mp4'
    const ext = /webm|opus/i.test(mime) ? 'webm' : 'm4a'
    return {
      mode: 'single',
      kind: 'audio',
      mediaUrl,
      mimeType: mime,
      filename: `${base}.${ext}`,
      quality: opts.quality,
      title: meta.title,
      needsMux: false,
      availableHeights,
    }
  }

  // ≤720p: prefer progressive muxed file (no browser remux)
  if (opts.quality <= 720) {
    try {
      const format = chooseProgressiveFormat(info, opts.quality)
      const mediaUrl = await decipherUrl(format, info)
      const mime = mimeOf(format) || 'video/mp4'
      return {
        mode: 'single',
        kind: 'video',
        mediaUrl,
        mimeType: mime,
        filename: `${base}.mp4`,
        quality: format.height || opts.quality,
        title: meta.title,
        needsMux: false,
        availableHeights,
      }
    } catch {
      // fall through to adaptive
    }
  }

  // High-res (or progressive unavailable): separate video + audio for client remux
  const videoFormat = chooseAdaptiveVideoFormat(info, opts.quality)
  const audioFormat = chooseAudioFormat(info)
  const [videoUrl, audioUrl] = await Promise.all([
    decipherUrl(videoFormat, info),
    decipherUrl(audioFormat, info),
  ])

  return {
    mode: 'adaptive',
    kind: 'video',
    videoUrl,
    audioUrl,
    videoMime: mimeOf(videoFormat) || 'video/mp4',
    audioMime: mimeOf(audioFormat) || 'audio/mp4',
    filename: `${base}.mp4`,
    quality: videoFormat.height || opts.quality,
    title: meta.title,
    needsMux: true,
    availableHeights,
  }
}

export async function downloadYoutubeStream(
  sourceUrl: string,
  opts: {
    kind: 'audio' | 'video'
    quality: number
    /** For adaptive mux: which leg to fetch when token has no direct URL */
    part?: 'video' | 'audio' | 'auto'
  },
): Promise<{ stream: ReadableStream<Uint8Array>; mimeType: string; filename: string; title: string }> {
  const meta = await resolveYoutube(sourceUrl)
  const tube = await getTube()
  const hints = youtubeOutputHints(meta, opts)
  const part = opts.part || 'auto'
  const ytHeaders = {
    'User-Agent':
      'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip',
    Accept: '*/*',
  }

  // Prefer direct CDN URL first — more stable through Vite middleware than tube.download()
  try {
    const delivery = await pickYoutubeDelivery(sourceUrl, opts)
    if (delivery.mode === 'adaptive') {
      const wantAudio = part === 'audio' || (part === 'auto' && opts.kind === 'audio')
      const mediaUrl = wantAudio ? delivery.audioUrl : delivery.videoUrl
      const mimeType = wantAudio ? delivery.audioMime : delivery.videoMime
      const filename = wantAudio
        ? delivery.filename.replace(/\.mp4$/i, '.m4a')
        : delivery.filename
      const res = await fetch(mediaUrl, { headers: ytHeaders })
      if (res.ok && res.body) {
        return { stream: res.body, mimeType, filename, title: delivery.title }
      }
    } else {
      const res = await fetch(delivery.mediaUrl, { headers: ytHeaders })
      if (res.ok && res.body) {
        return {
          stream: res.body,
          mimeType: delivery.mimeType,
          filename: delivery.filename,
          title: delivery.title,
        }
      }
    }
  } catch {
    // fall through to Innertube download
  }

  const downloadKind =
    part === 'audio' || opts.kind === 'audio'
      ? 'audio'
      : part === 'video'
        ? 'video'
        : opts.quality > 720
          ? 'video'
          : 'video+audio'

  const qualities =
    downloadKind === 'audio' ? ['best'] : videoQualityFallbacks(opts.quality)

  let lastErr: unknown
  for (const client of clientLadder()) {
    for (const quality of qualities) {
      try {
        const stream = await tube.download(meta.videoId, {
          type: downloadKind,
          quality,
          format: 'any',
          client,
        })
        return {
          stream,
          mimeType:
            downloadKind === 'audio'
              ? 'audio/mp4'
              : hints.mimeType,
          filename:
            downloadKind === 'audio'
              ? hints.filename
              : hints.filename,
          title: meta.title,
        }
      } catch (err) {
        lastErr = err
      }
    }
  }

  throw new Error(
    lastErr instanceof Error ? lastErr.message : 'YouTube download failed',
  )
}
