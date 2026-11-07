import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { friendlyApiError } from './_lib/friendly.js'
import { handleOptions, sendError, setCors } from './_lib/http.js'
import { igFetchHeaders } from './_lib/instagram.js'
import { clientIp, rateLimit } from './_lib/rateLimit.js'
import { verifyToken } from './_lib/token.js'
import { assertAllowedMediaUrl } from './_lib/validate.js'
import { downloadYoutubeStream } from './_lib/youtube.js'

export const config = {
  maxDuration: 300,
}

function nodeStreamFromWeb(body: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(body as import('node:stream/web').ReadableStream)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return
  if (req.method !== 'GET') {
    sendError(res, 405, 'Method not allowed')
    return
  }

  const rl = rateLimit(`stream:${clientIp(req)}`, 20, 60_000)
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining))
  if (!rl.ok) {
    sendError(res, 429, 'Too many requests — slow down a bit')
    return
  }

  try {
    const tokenParam = typeof req.query.token === 'string' ? req.query.token : ''
    if (!tokenParam) {
      sendError(res, 400, 'token is required')
      return
    }

    const payload = verifyToken(tokenParam)
    setCors(res)
    res.setHeader('Content-Disposition', `attachment; filename="${payload.filename.replace(/"/g, '')}"`)
    res.setHeader('Cache-Control', 'no-store')

    if (payload.platform === 'youtube') {
      // Prefer Innertube download stream (handles cipher / segments)
      try {
        const dl = await downloadYoutubeStream(payload.sourceUrl, {
          kind: payload.kind,
          quality: payload.quality,
        })
        res.setHeader('Content-Type', dl.mimeType)
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${dl.filename.replace(/"/g, '')}"`,
        )
        await pipeline(nodeStreamFromWeb(dl.stream), res)
        return
      } catch {
        // fall through to direct mediaUrl proxy
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
    res.setHeader('Content-Type', contentType)
    const len = upstream.headers.get('content-length')
    if (len) res.setHeader('Content-Length', len)

    await pipeline(nodeStreamFromWeb(upstream.body), res)
  } catch (err) {
    const friendly = friendlyApiError(err)
    if (!res.headersSent) {
      sendError(res, 400, friendly.error, { code: friendly.code, hint: friendly.hint })
    } else {
      res.destroy(err instanceof Error ? err : undefined)
    }
  }
}
