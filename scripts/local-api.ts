/**
 * Local API server for `npm run dev` (no Vercel CLI required).
 * Mirrors /api/resolve, /api/stream, /api/health.
 */
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

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

loadEnvFile('.env.local')
loadEnvFile('.env')
import { resolveInstagram, igFetchHeaders } from '../api/_lib/instagram.ts'
import { clientIp, rateLimit } from '../api/_lib/rateLimit.ts'
import { signToken, verifyToken } from '../api/_lib/token.ts'
import {
  assertAllowedMediaUrl,
  detectPlatform,
  normalizeUrl,
} from '../api/_lib/validate.ts'
import {
  downloadYoutubeStream,
  resolveYoutube,
  youtubeOutputHints,
} from '../api/_lib/youtube.ts'

const PORT = Number(process.env.WAVEY_API_PORT || 8787)

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(payload)
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  sendJson(res, status, { ok: false, error: message })
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function nodeStreamFromWeb(body: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(body as import('node:stream/web').ReadableStream)
}

async function handleResolve(req: http.IncomingMessage, res: http.ServerResponse) {
  const rl = rateLimit(`resolve:${clientIp({ headers: req.headers as Record<string, string | string[] | undefined> })}`, 40, 60_000)
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining))
  if (!rl.ok) {
    sendError(res, 429, 'Too many requests — slow down a bit')
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
      note: 'Instagram serves one rendered file — effects, captions, and audio are baked in as posted.',
    })
  } catch (err) {
    sendError(res, 400, err instanceof Error ? err.message : 'Resolve failed')
  }
}

async function handleStream(req: http.IncomingMessage, res: http.ServerResponse) {
  const rl = rateLimit(`stream:${clientIp({ headers: req.headers as Record<string, string | string[] | undefined> })}`, 20, 60_000)
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining))
  if (!rl.ok) {
    sendError(res, 429, 'Too many requests — slow down a bit')
    return
  }

  try {
    const u = new URL(req.url || '/', 'http://localhost')
    const tokenParam = u.searchParams.get('token') || ''
    if (!tokenParam) {
      sendError(res, 400, 'token is required')
      return
    }

    const payload = verifyToken(tokenParam)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${payload.filename.replace(/"/g, '')}"`,
    )

    if (payload.platform === 'youtube') {
      try {
        const dl = await downloadYoutubeStream(payload.sourceUrl, {
          kind: payload.kind,
          quality: payload.quality,
        })
        res.writeHead(200, {
          'Content-Type': dl.mimeType,
          'Content-Disposition': `attachment; filename="${dl.filename.replace(/"/g, '')}"`,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        })
        await pipeline(nodeStreamFromWeb(dl.stream), res)
        return
      } catch {
        // fall through to mediaUrl proxy
      }
    }

    if (!payload.mediaUrl) {
      sendError(res, 400, 'No media URL in token — resolve again')
      return
    }

    const mediaUrl = assertAllowedMediaUrl(payload.mediaUrl)
    const headers: Record<string, string> =
      payload.platform === 'instagram'
        ? igFetchHeaders()
        : {
            'User-Agent':
              'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip',
            Accept: '*/*',
          }

    const upstream = await fetch(mediaUrl.toString(), { headers })
    if (!upstream.ok || !upstream.body) {
      sendError(res, 502, `Upstream fetch failed (${upstream.status})`)
      return
    }

    const contentType =
      payload.mimeType ||
      upstream.headers.get('content-type') ||
      'application/octet-stream'
    const head: Record<string, string> = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${payload.filename.replace(/"/g, '')}"`,
    }
    const len = upstream.headers.get('content-length')
    if (len) head['Content-Length'] = len
    res.writeHead(200, head)
    await pipeline(nodeStreamFromWeb(upstream.body), res)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stream failed'
    if (!res.headersSent) sendError(res, 400, message)
    else res.destroy(err instanceof Error ? err : undefined)
  }
}

const server = http.createServer((req, res) => {
  void (async () => {
    const path = (req.url || '/').split('?')[0]

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end()
      return
    }

    if (path === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        service: 'wavey-local',
        storiesConfigured: Boolean(process.env.IG_SESSIONID),
        youtubeCookie: Boolean(process.env.YT_COOKIE),
        tokenSecret: Boolean(process.env.WAVEY_TOKEN_SECRET),
      })
      return
    }

    if (path === '/api/resolve' && req.method === 'POST') {
      await handleResolve(req, res)
      return
    }

    if (path === '/api/stream' && req.method === 'GET') {
      await handleStream(req, res)
      return
    }

    sendError(res, 404, 'Not found')
  })().catch((err) => {
    if (!res.headersSent) {
      sendError(res, 500, err instanceof Error ? err.message : 'Internal error')
    }
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[wavey-api] http://127.0.0.1:${PORT}`)
})
