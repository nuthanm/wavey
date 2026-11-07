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
import { friendlyApiError } from '../api/_lib/friendly.ts'
import { resolveInstagram, igFetchHeaders } from '../api/_lib/instagram.ts'
import { clientIp, rateLimit } from '../api/_lib/rateLimit.ts'
import { signToken, verifyToken } from '../api/_lib/token.ts'
import {
  assertAllowedMediaUrl,
  detectPlatform,
  normalizeUrl,
  contentDispositionAttachment,
} from '../api/_lib/validate.ts'
import {
  downloadYoutubeStream,
  resolveYoutube,
  youtubeOutputHints,
} from '../api/_lib/youtube.ts'

const PORT = Number(process.env.WAVEY_API_PORT || 8787)

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Chrome private-network / localhost quirks
    'Access-Control-Allow-Private-Network': 'true',
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(),
  })
  res.end(payload)
}

function sendError(
  res: http.ServerResponse,
  status: number,
  message: string,
  extra?: { code?: string; hint?: string },
) {
  sendJson(res, status, {
    ok: false,
    error: message,
    ...(extra?.code ? { code: extra.code } : {}),
    ...(extra?.hint ? { hint: extra.hint } : {}),
  })
}

function sendFriendly(res: http.ServerResponse, status: number, err: unknown) {
  const friendly = friendlyApiError(err)
  sendError(res, status, friendly.error, { code: friendly.code, hint: friendly.hint })
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
    sendFriendly(res, 400, err)
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
    for (const [k, v] of Object.entries(corsHeaders())) res.setHeader(k, v)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', contentDispositionAttachment(payload.filename))

    if (payload.platform === 'youtube') {
      try {
        const dl = await downloadYoutubeStream(payload.sourceUrl, {
          kind: payload.kind,
          quality: payload.quality,
        })
        res.writeHead(200, {
          'Content-Type': dl.mimeType,
          'Content-Disposition': contentDispositionAttachment(dl.filename),
          ...corsHeaders(),
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
      ...corsHeaders(),
      'Cache-Control': 'no-store',
      'Content-Disposition': contentDispositionAttachment(payload.filename),
    }
    const len = upstream.headers.get('content-length')
    if (len) head['Content-Length'] = len
    res.writeHead(200, head)
    await pipeline(nodeStreamFromWeb(upstream.body), res)
  } catch (err) {
    if (!res.headersSent) sendFriendly(res, 400, err)
    else res.destroy(err instanceof Error ? err : undefined)
  }
}

const server = http.createServer((req, res) => {
  void (async () => {
    const method = (req.method || 'GET').toUpperCase()
    const path = ((req.url || '/').split('?')[0] || '/').replace(/\/+$/, '') || '/'

    console.log(`[wavey-api] ${method} ${path}`)

    if (method === 'OPTIONS') {
      res.writeHead(204, corsHeaders())
      res.end()
      return
    }

    if (path === '/api/health') {
      if (method !== 'GET') {
        sendError(res, 405, 'health is GET only', { code: 'bad_method' })
        return
      }
      sendJson(res, 200, {
        ok: true,
        service: 'wavey-local',
        storiesConfigured: Boolean(process.env.IG_SESSIONID),
        youtubeCookie: Boolean(process.env.YT_COOKIE),
        tokenSecret: Boolean(process.env.WAVEY_TOKEN_SECRET),
      })
      return
    }

    if (path === '/api/resolve') {
      if (method !== 'POST') {
        sendError(res, 405, 'resolve needs POST from the Wavey app — don’t open this URL in the browser', {
          code: 'bad_method',
          hint: 'use http://localhost:5173 and paste a link there',
        })
        return
      }
      await handleResolve(req, res)
      return
    }

    if (path === '/api/stream') {
      if (method !== 'GET') {
        sendError(res, 405, 'stream is GET only', { code: 'bad_method' })
        return
      }
      await handleStream(req, res)
      return
    }

    sendError(res, 404, `no route for ${method} ${path}`, {
      code: 'not_found',
      hint: 'open the app at http://localhost:5173 — not the :8787 API port',
    })
  })().catch((err) => {
    if (!res.headersSent) {
      sendFriendly(res, 500, err)
    }
  })
})

// Long YouTube pulls — don't let Node kill idle sockets mid-stream
server.requestTimeout = 0
server.headersTimeout = 0
server.timeout = 0
server.keepAliveTimeout = 120_000

// Bind all local interfaces so both localhost and 127.0.0.1 work (Windows IPv6 quirk).
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[wavey-api] convert backend ready → http://localhost:${PORT}`)
  console.log(`[wavey-api] keep this running while you use the UI on :5173`)
})
