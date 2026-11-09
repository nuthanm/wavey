/**
 * Vite middleware: serve /api/* on the same origin as the UI (no :8787, no CORS).
 * Avoids browser/extension failures talking to a second port.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fetchToBuffer, streamToBuffer } from '../api/_lib/buffer.ts'
import { friendlyApiError } from '../api/_lib/friendly.ts'
import { igFetchHeaders, resolveInstagram } from '../api/_lib/instagram.ts'
import { clientIp, rateLimit } from '../api/_lib/rateLimit.ts'
import { signToken, verifyToken } from '../api/_lib/token.ts'
import {
  assertAllowedMediaUrl,
  contentDispositionAttachment,
  detectPlatform,
  normalizeUrl,
} from '../api/_lib/validate.ts'
import {
  downloadYoutubeStream,
  pickYoutubeDelivery,
  resolveYoutube,
  youtubeOutputHints,
} from '../api/_lib/youtube.ts'

function loadEnvFile(filename: string) {
  const path = resolve(process.cwd(), filename)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i <= 0) continue
    const key = trimmed.slice(0, i).trim()
    let val = trimmed.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, status: number, err: unknown) {
  const friendly = friendlyApiError(err)
  sendJson(res, status, {
    ok: false,
    error: friendly.error,
    code: friendly.code,
    hint: friendly.hint,
  })
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function handleResolve(req: IncomingMessage, res: ServerResponse) {
  const rl = rateLimit(
    `resolve:${clientIp({ headers: req.headers as Record<string, string | string[] | undefined> })}`,
    40,
    60_000,
  )
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining))
  if (!rl.ok) {
    sendError(res, 429, 'Too many requests')
    return
  }

  try {
    const raw = await readBody(req)
    const body = raw ? (JSON.parse(raw) as { url?: string; output?: string; quality?: number }) : {}
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
      let mediaUrl: string | undefined
      let audioUrl: string | undefined
      let mimeType = hints.mimeType
      let audioMimeType: string | undefined
      let filename = hints.filename
      let needsMux = false
      let actualQuality = quality
      let availableHeights: number[] = []

      try {
        const delivery = await pickYoutubeDelivery(url.toString(), { kind, quality })
        availableHeights = delivery.availableHeights
        actualQuality = delivery.quality
        filename = delivery.filename
        if (delivery.mode === 'adaptive') {
          // Don't embed long CDN URLs in the token (URL length limits). Stream re-picks.
          mimeType = delivery.videoMime
          audioMimeType = delivery.audioMime
          needsMux = true
        } else {
          mediaUrl = delivery.mediaUrl
          mimeType = delivery.mimeType
          needsMux = false
        }
      } catch {
        needsMux = kind === 'video' && quality > 720
      }

      const token = signToken({
        platform: 'youtube',
        sourceUrl: url.toString(),
        kind,
        quality,
        mediaUrl,
        audioUrl,
        mimeType,
        audioMimeType,
        filename,
        title: meta.title,
        needsMux,
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
        mimeType,
        filename,
        token,
        needsEncode: hints.needsEncode,
        needsMux,
        actualQuality,
        availableHeights,
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
      needsMux: false,
      availableHeights: [],
      note: 'Instagram serves one rendered file — effects, captions, and audio are baked in as posted.',
    })
  } catch (err) {
    sendError(res, 400, err)
  }
}

async function handleStream(req: IncomingMessage, res: ServerResponse) {
  const rl = rateLimit(
    `stream:${clientIp({ headers: req.headers as Record<string, string | string[] | undefined> })}`,
    20,
    60_000,
  )
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining))
  if (!rl.ok) {
    sendError(res, 429, 'Too many requests')
    return
  }

  try {
    const u = new URL(req.url || '/', 'http://localhost')
    const tokenParam = u.searchParams.get('token') || ''
    if (!tokenParam) {
      sendError(res, 400, 'token is required')
      return
    }

    const partRaw = (u.searchParams.get('part') || 'auto').toLowerCase()
    const part: 'video' | 'audio' | 'auto' =
      partRaw === 'audio' || partRaw === 'video' ? partRaw : 'auto'

    const payload = verifyToken(tokenParam)
    const ytHeaders = {
      'User-Agent':
        'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip',
      Accept: '*/*',
    }

    let buffer: Buffer | undefined
    let contentType = payload.mimeType || 'application/octet-stream'
    let filename = payload.filename
    let mediaErr: unknown

    const wantAudio =
      part === 'audio' || (part === 'auto' && payload.kind === 'audio' && !payload.needsMux)

    if (payload.platform === 'youtube' && payload.needsMux && part === 'auto') {
      sendError(res, 400, 'Adaptive stream needs part=video or part=audio')
      return
    }

    const directUrl = wantAudio ? payload.audioUrl || payload.mediaUrl : payload.mediaUrl
    if (directUrl && !(payload.needsMux && part === 'auto')) {
      try {
        const mediaUrl = assertAllowedMediaUrl(directUrl)
        const headers = payload.platform === 'instagram' ? igFetchHeaders() : ytHeaders
        const fetched = await fetchToBuffer(mediaUrl.toString(), headers)
        buffer = fetched.buffer
        contentType =
          (wantAudio ? payload.audioMimeType : payload.mimeType) || fetched.contentType
        if (wantAudio && payload.needsMux) {
          filename = payload.filename.replace(/\.mp4$/i, '.m4a')
        }
      } catch (err) {
        mediaErr = err
        if (payload.platform !== 'youtube') throw err
      }
    }

    if (!buffer && payload.platform === 'youtube') {
      const dl = await downloadYoutubeStream(payload.sourceUrl, {
        kind: wantAudio ? 'audio' : payload.kind,
        quality: payload.quality,
        part: payload.needsMux ? (wantAudio ? 'audio' : 'video') : part,
      })
      buffer = await streamToBuffer(dl.stream)
      contentType = dl.mimeType
      filename = dl.filename
    }
    if (!buffer) {
      throw mediaErr || new Error('No media URL in token — resolve again')
    }

    res.statusCode = 200
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', String(buffer.byteLength))
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', contentDispositionAttachment(filename))
    res.end(buffer)
  } catch (err) {
    if (!res.headersSent) sendError(res, 400, err)
    else res.destroy(err instanceof Error ? err : undefined)
  }
}

export function waveyApiPlugin(): Plugin {
  return {
    name: 'wavey-api',
    configureServer(server) {
      loadEnvFile('.env.local')
      loadEnvFile('.env')
      if (!process.env.WAVEY_TOKEN_SECRET) {
        process.env.WAVEY_TOKEN_SECRET = 'wavey-dev-secret-change-me'
      }

      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || '/'
        const path = (rawUrl.split('?')[0] || '/').replace(/\/+$/, '') || '/'
        if (!path.startsWith('/api')) return next()

        void (async () => {
          const method = (req.method || 'GET').toUpperCase()
          console.log(`[wavey-api:vite] ${method} ${path}`)

          if (method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }

          if (path === '/api/health' && method === 'GET') {
            const { ytCookieStatus } = await import('../api/_lib/ytCookie.ts')
            const yt = ytCookieStatus(process.env.YT_COOKIE)
            sendJson(res, 200, {
              ok: true,
              service: 'wavey-vite',
              storiesConfigured: Boolean(process.env.IG_SESSIONID),
              youtubeCookie: yt.configured,
              youtubeCookieUsable: yt.usable,
              ageRestrictedUnlocked: yt.usable,
              tokenSecret: Boolean(process.env.WAVEY_TOKEN_SECRET),
            })
            return
          }

          if (path === '/api/resolve' && method === 'POST') {
            await handleResolve(req, res)
            return
          }

          if (path === '/api/stream' && method === 'GET') {
            await handleStream(req, res)
            return
          }

          sendJson(res, 404, {
            ok: false,
            error: `no route for ${method} ${path}`,
            hint: 'use the Wavey UI — paste a link and pull',
          })
        })().catch((err) => {
          if (!res.headersSent) sendError(res, 500, err)
        })
      })
    },
  }
}
