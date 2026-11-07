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

async function getInfo(videoId: string) {
  const tube = await getTube()
  try {
    return await tube.getBasicInfo(videoId, { client: 'ANDROID' })
  } catch {
    return tube.getBasicInfo(videoId, { client: 'WEB' })
  }
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

export async function pickYoutubeFormat(
  sourceUrl: string,
  opts: { kind: 'audio' | 'video'; quality: number },
): Promise<PickedFormat & { title: string }> {
  const meta = await resolveYoutube(sourceUrl)
  const info = await getInfo(meta.videoId)

  const format = info.chooseFormat({
    type: opts.kind === 'audio' ? 'audio' : 'video+audio',
    quality: opts.kind === 'audio' ? 'best' : videoQualityLabel(opts.quality),
    format: opts.kind === 'audio' ? 'any' : 'mp4',
  })

  const mediaUrl = await format.decipher(info.actions.session.player)
  if (!mediaUrl) throw new Error('Could not decipher stream URL')

  const ext =
    opts.kind === 'audio'
      ? /webm|opus/i.test(format.mime_type)
        ? 'webm'
        : 'm4a'
      : 'mp4'
  const base = sanitizeFilename(meta.title)

  return {
    mediaUrl,
    mimeType: format.mime_type.split(';')[0]!.trim(),
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

  try {
    const stream = await tube.download(meta.videoId, {
      type: opts.kind === 'audio' ? 'audio' : 'video+audio',
      quality: opts.kind === 'audio' ? 'best' : videoQualityLabel(opts.quality),
      format: opts.kind === 'audio' ? 'any' : 'mp4',
      client: 'ANDROID',
    })
    const picked = await pickYoutubeFormat(sourceUrl, opts).catch(() => null)
    return {
      stream,
      mimeType: picked?.mimeType || (opts.kind === 'audio' ? 'audio/mp4' : 'video/mp4'),
      filename:
        picked?.filename ||
        `${sanitizeFilename(meta.title)}.${opts.kind === 'audio' ? 'm4a' : 'mp4'}`,
      title: meta.title,
    }
  } catch {
    // Fallback: proxy the deciphered CDN URL directly
    const picked = await pickYoutubeFormat(sourceUrl, opts)
    const res = await fetch(picked.mediaUrl, {
      headers: {
        'User-Agent':
          'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip',
        Accept: '*/*',
      },
    })
    if (!res.ok || !res.body) {
      throw new Error(`Upstream media fetch failed (${res.status})`)
    }
    return {
      stream: res.body,
      mimeType: picked.mimeType,
      filename: picked.filename,
      title: picked.title,
    }
  }
}
