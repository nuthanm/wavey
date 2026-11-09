/** Normalize / validate YT_COOKIE so age-restricted pulls can use a signed-in session. */

function parseCookieMap(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of raw.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (key) map.set(key, val)
  }
  return map
}

function serializeCookieMap(map: Map<string, string>): string {
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/**
 * Browsers often only expose `__Secure-3PAPISID` / `__Secure-3PSID`.
 * youtubei.js auth looks for `SAPISID` — mirror secure variants when missing.
 */
export function normalizeYtCookie(raw: string | undefined | null): string | undefined {
  if (!raw?.trim()) return undefined
  let cookie = raw.trim()
  if (
    (cookie.startsWith('"') && cookie.endsWith('"')) ||
    (cookie.startsWith("'") && cookie.endsWith("'"))
  ) {
    cookie = cookie.slice(1, -1).trim()
  }

  const map = parseCookieMap(cookie)
  const securePapisid = map.get('__Secure-3PAPISID')
  const securePsid = map.get('__Secure-3PSID')
  if (!map.get('SAPISID') && securePapisid) map.set('SAPISID', securePapisid)
  if (!map.get('SID') && securePsid) map.set('SID', securePsid)
  if (!map.get('HSID') && map.get('__Secure-3PSIDTS')) {
    // leave as-is — not always mappable
  }

  return serializeCookieMap(map)
}

export function ytCookieStatus(raw: string | undefined | null): {
  configured: boolean
  hasSapisid: boolean
  hasSid: boolean
  usable: boolean
  hint?: string
} {
  const normalized = normalizeYtCookie(raw)
  if (!normalized) {
    return {
      configured: false,
      hasSapisid: false,
      hasSid: false,
      usable: false,
      hint: 'Set YT_COOKIE from a logged-in YouTube session to unlock age-restricted videos.',
    }
  }
  const map = parseCookieMap(normalized)
  const hasSapisid = Boolean(map.get('SAPISID') || map.get('__Secure-3PAPISID'))
  const hasSid = Boolean(map.get('SID') || map.get('__Secure-3PSID') || map.get('SSID'))
  const usable = hasSapisid && hasSid
  return {
    configured: true,
    hasSapisid,
    hasSid,
    usable,
    hint: usable
      ? undefined
      : 'YT_COOKIE is set but missing SID/SAPISID — copy the full Cookie header from youtube.com while logged in.',
  }
}

export function getYtCookie(): string | undefined {
  return normalizeYtCookie(process.env.YT_COOKIE)
}
