import { Innertube, UniversalCache } from 'youtubei.js'
import { extractYoutubeId, formatDuration, sanitizeFilename } from './validate.js'

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

let innertubePromise: Promise<Innertube> | null = null

function resetTube() {
  innertubePromise = null
}

async function getTube(): Promise<Innertube> {
  if (!innertubePromise) {
    innertubePromise = Innertube.create({
      cache: new UniversalCache(false),
      retrieve_player: true,
      cookie: process.env.YT_COOKIE || undefined,
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

const CLIENTS = ['ANDROID', 'IOS', 'TV', 'WEB'] as const

async function getInfo(videoId: string) {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    const tube = await getTube()
    for (const client of CLIENTS) {
      try {
        return await tube.getBasicInfo(videoId, { client })
      } catch (err) {
        lastErr = err
        const msg = err instanceof Error ? err.message : String(err)
        if (/non 2xx|fetch_failed/i.test(msg)) resetTube()
      }
    }
    resetTube()
  }
  throw lastErr instanceof Error ? lastErr : new Error('Failed to load YouTube info')
}

export async function resolveYoutube(sourceUrl: string): Promise<ResolvedMedia> {
  const url = new URL(sourceUrl)
  const videoId = extractYoutubeId(url)
  if (!videoId) throw new Error('Could not parse YouTube video id')

  const info = await getInfo(videoId)
  const status = info.playability_status?.status
  if (status && status !== 'OK') {
    throw new Error(info.playability_status?.reason || 'Video is not playable')
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

function videoQualityLabel(height: number): string {
  if (height >= 2160) return '2160p'
  if (height >= 1440) return '1440p'
  if (height >= 1080) return '1080p'
  if (height >= 720) return '720p'
  return '480p'
}

export function youtubeOutputHints(
  meta: ResolvedMedia,
  opts: { kind: 'audio' | 'video'; quality: number },
): { mimeType: string; filename: string; needsEncode: boolean } {
  const base = sanitizeFilename(meta.title)
  if (opts.kind === 'audio') {
    return {
      mimeType: 'audio/mp4',
      filename: `${base}.m4a`,
      needsEncode: true,
    }
  }
  return {
    mimeType: 'video/mp4',
    filename: `${base}.mp4`,
    needsEncode: false,
  }
}

function videoQualityFallbacks(height: number): Array<string | number> {
  const label = videoQualityLabel(height)
  const ladder = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p']
  const idx = ladder.indexOf(label)
  const fromRequested = idx >= 0 ? ladder.slice(idx) : ladder.slice(2)
  return [...fromRequested, 'best', 'bestefficiency']
}

function chooseBestFormat(
  info: Awaited<ReturnType<typeof getInfo>>,
  opts: { kind: 'audio' | 'video'; quality: number },
) {
  if (opts.kind === 'audio') {
    return info.chooseFormat({ type: 'audio', quality: 'best', format: 'any' })
  }

  let lastErr: unknown
  for (const quality of videoQualityFallbacks(opts.quality)) {
    try {
      const format = info.chooseFormat({
        type: 'video+audio',
        quality,
        format: 'any',
      })
      const mime = (format.mime_type || '').toLowerCase()
      if (mime.startsWith('audio/')) {
        lastErr = new Error('audio-only format')
        continue
      }
      return format
    } catch (err) {
      lastErr = err
    }
  }

  // Last ditch: any video (may be video-only)
  try {
    return info.chooseFormat({ type: 'video', quality: 'best', format: 'any' })
  } catch (err) {
    throw lastErr instanceof Error ? lastErr : err
  }
}

export async function pickYoutubeFormat(
  sourceUrl: string,
  opts: { kind: 'audio' | 'video'; quality: number },
): Promise<PickedFormat & { title: string }> {
  const meta = await resolveYoutube(sourceUrl)
  const info = await getInfo(meta.videoId)
  const format = chooseBestFormat(info, opts)

  const mime = (format.mime_type || '').split(';')[0]!.trim().toLowerCase()
  if (opts.kind === 'video' && mime.startsWith('audio/')) {
    throw new Error('No progressive video URL — use Innertube download')
  }
  if (opts.kind === 'audio' && mime.startsWith('video/')) {
    throw new Error('Got video container for audio request')
  }

  let mediaUrl = format.url || ''
  if (!mediaUrl) {
    try {
      mediaUrl = await format.decipher(info.actions.session.player)
    } catch {
      mediaUrl = ''
    }
  }
  if (!mediaUrl) {
    throw new Error('No valid URL to decipher — try again or set YT_COOKIE')
  }

  const ext =
    opts.kind === 'audio'
      ? /webm|opus/i.test(mime)
        ? 'webm'
        : 'm4a'
      : 'mp4'
  const base = sanitizeFilename(meta.title)

  return {
    mediaUrl,
    mimeType: mime || (opts.kind === 'audio' ? 'audio/mp4' : 'video/mp4'),
    kind: opts.kind,
    quality: opts.kind === 'audio' ? opts.quality : format.height || opts.quality,
    filename: `${base}.${ext}`,
    contentLength: format.content_length,
    title: meta.title,
  }
}

export async function downloadYoutubeStream(
  sourceUrl: string,
  opts: { kind: 'audio' | 'video'; quality: number },
): Promise<{ stream: ReadableStream<Uint8Array>; mimeType: string; filename: string; title: string }> {
  const meta = await resolveYoutube(sourceUrl)
  const tube = await getTube()
  const hints = youtubeOutputHints(meta, opts)
  const ytHeaders = {
    'User-Agent':
      'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip',
    Accept: '*/*',
  }

  // Prefer direct CDN URL first — more stable through Vite middleware than tube.download()
  try {
    const picked = await pickYoutubeFormat(sourceUrl, opts)
    const res = await fetch(picked.mediaUrl, { headers: ytHeaders })
    if (res.ok && res.body) {
      return {
        stream: res.body,
        mimeType: picked.mimeType,
        filename: picked.filename,
        title: picked.title,
      }
    }
  } catch {
    // fall through to Innertube download
  }

  const qualities =
    opts.kind === 'audio'
      ? (['best'] as Array<string | number>)
      : videoQualityFallbacks(opts.quality)

  let lastErr: unknown
  for (const client of CLIENTS) {
    for (const quality of qualities) {
      try {
        const stream = await tube.download(meta.videoId, {
          type: opts.kind === 'audio' ? 'audio' : 'video+audio',
          quality,
          format: 'any',
          client,
        })
        return {
          stream,
          mimeType: hints.mimeType,
          filename: hints.filename,
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
