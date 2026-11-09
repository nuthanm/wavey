import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleOptions, sendJson } from './_lib/http.js'
import { ytCookieStatus } from './_lib/ytCookie.js'

export const config = {
  maxDuration: 10,
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' })
    return
  }
  const yt = ytCookieStatus(process.env.YT_COOKIE)
  sendJson(res, 200, {
    ok: true,
    service: 'wavey',
    storiesConfigured: Boolean(process.env.IG_SESSIONID),
    youtubeCookie: yt.configured,
    youtubeCookieUsable: yt.usable,
    ageRestrictedUnlocked: yt.usable,
    tokenSecret: Boolean(process.env.WAVEY_TOKEN_SECRET) || process.env.NODE_ENV !== 'production',
  })
}
