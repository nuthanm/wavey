import type { VercelRequest, VercelResponse } from '@vercel/node'
import { fetchToBuffer, streamToBuffer } from './_lib/buffer.js'
import { friendlyApiError } from './_lib/friendly.js'
import { handleOptions, sendError, setCors } from './_lib/http.js'
import { igFetchHeaders } from './_lib/instagram.js'
import { clientIp, rateLimit } from './_lib/rateLimit.js'
import { verifyToken } from './_lib/token.js'
import { assertAllowedMediaUrl, contentDispositionAttachment } from './_lib/validate.js'
import { downloadYoutubeStream } from './_lib/youtube.js'

export const config = {
  maxDuration: 300,
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

    const ytHeaders = {
      'User-Agent':
        'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip',
      Accept: '*/*',
    }

    let buffer: Buffer | undefined
    let contentType = payload.mimeType || 'application/octet-stream'
    let filename = payload.filename
    let mediaErr: unknown

    if (payload.mediaUrl) {
      try {
        const mediaUrl = assertAllowedMediaUrl(payload.mediaUrl)
        const headers = payload.platform === 'instagram' ? igFetchHeaders() : ytHeaders
        const fetched = await fetchToBuffer(mediaUrl.toString(), headers)
        buffer = fetched.buffer
        contentType = payload.mimeType || fetched.contentType
      } catch (err) {
        mediaErr = err
        if (payload.platform !== 'youtube') throw err
      }
    }

    if (!buffer && payload.platform === 'youtube') {
      const dl = await downloadYoutubeStream(payload.sourceUrl, {
        kind: payload.kind,
        quality: payload.quality,
      })
      buffer = await streamToBuffer(dl.stream)
      contentType = dl.mimeType
      filename = dl.filename
    }
    if (!buffer) {
      throw mediaErr || new Error('No media URL in token — resolve again')
    }

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', String(buffer.byteLength))
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', contentDispositionAttachment(filename))
    res.status(200).end(buffer)
  } catch (err) {
    const friendly = friendlyApiError(err)
    if (!res.headersSent) {
      sendError(res, 400, friendly.error, { code: friendly.code, hint: friendly.hint })
    } else {
      res.destroy(err instanceof Error ? err : undefined)
    }
  }
}
