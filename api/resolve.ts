import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleOptions, readJsonBody, sendError, sendJson } from './_lib/http.js'
import { resolveInstagram } from './_lib/instagram.js'
import { clientIp, rateLimit } from './_lib/rateLimit.js'
import { signToken } from './_lib/token.js'
import { detectPlatform, normalizeUrl } from './_lib/validate.js'
import { resolveYoutube, youtubeOutputHints } from './_lib/youtube.js'

export const config = {
  maxDuration: 60,
}

type Body = {
  url?: string
  output?: 'mp3' | 'mp4'
  /** audio kbps or video height */
  quality?: number
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return
  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed')
    return
  }

  const rl = rateLimit(`resolve:${clientIp(req)}`, 40, 60_000)
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining))
  if (!rl.ok) {
    sendError(res, 429, 'Too many requests — slow down a bit')
    return
  }

  try {
    const body = await readJsonBody<Body>(req)
    if (!body.url) {
      sendError(res, 400, 'url is required')
      return
    }

    const url = normalizeUrl(body.url)
    const platform = detectPlatform(url)
    if (!platform) {
      sendError(res, 400, 'Only YouTube and Instagram URLs are supported')
      return
    }

    const output = body.output === 'mp4' ? 'mp4' : 'mp3'
    const kind = output === 'mp4' ? 'video' : 'audio'
    const quality =
      typeof body.quality === 'number' && body.quality > 0
        ? body.quality
        : kind === 'audio'
          ? 320
          : 1080

    if (platform === 'youtube') {
      const meta = await resolveYoutube(url.toString())
      const hints = youtubeOutputHints(meta, { kind, quality })
      const token = signToken({
        platform: 'youtube',
        sourceUrl: url.toString(),
        kind,
        quality,
        mimeType: hints.mimeType,
        filename: hints.filename,
        title: meta.title,
      })

      sendJson(res, 200, {
        ok: true,
        platform: 'youtube',
        title: meta.title,
        creator: meta.creator,
        duration: meta.duration,
        durationSec: meta.durationSec,
        thumbUrl: meta.thumbUrl,
        thumbHue: meta.thumbHue,
        kindLabel: meta.kindLabel,
        mimeType: hints.mimeType,
        filename: hints.filename,
        token,
        needsEncode: hints.needsEncode,
      })
      return
    }

    const ig = await resolveInstagram(url.toString())
    const token = signToken({
      platform: 'instagram',
      sourceUrl: url.toString(),
      kind: ig.mimeType.startsWith('video/') ? (kind === 'audio' ? 'audio' : 'video') : 'video',
      quality,
      mediaUrl: ig.mediaUrl,
      mimeType: ig.mimeType,
      filename: ig.filename,
      title: ig.title,
    })

    sendJson(res, 200, {
      ok: true,
      platform: 'instagram',
      title: ig.title,
      creator: ig.creator,
      duration: ig.duration,
      durationSec: ig.durationSec,
      thumbUrl: ig.thumbUrl,
      thumbHue: ig.thumbHue,
      kindLabel: ig.kindLabel,
      mimeType: ig.mimeType,
      filename: ig.filename,
      isStory: ig.isStory,
      token,
      needsEncode: output === 'mp3',
      note:
        'Instagram serves one rendered file — effects, captions, and audio are baked in as posted.',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Resolve failed'
    sendError(res, 400, message)
  }
}
