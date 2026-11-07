type Bucket = { count: number; reset: number }

const buckets = new Map<string, Bucket>()

/** Simple per-instance rate limit. Good enough to blunt casual abuse. */
export function rateLimit(
  key: string,
  limit = 30,
  windowMs = 60_000,
): { ok: boolean; remaining: number; reset: number } {
  const now = Date.now()
  const cur = buckets.get(key)
  if (!cur || cur.reset < now) {
    const next = { count: 1, reset: now + windowMs }
    buckets.set(key, next)
    return { ok: true, remaining: limit - 1, reset: next.reset }
  }
  if (cur.count >= limit) {
    return { ok: false, remaining: 0, reset: cur.reset }
  }
  cur.count += 1
  return { ok: true, remaining: limit - cur.count, reset: cur.reset }
}

export function clientIp(req: { headers: Record<string, string | string[] | undefined> }): string {
  const xf = req.headers['x-forwarded-for']
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0]!.trim()
  if (Array.isArray(xf) && xf[0]) return xf[0].split(',')[0]!.trim()
  const real = req.headers['x-real-ip']
  if (typeof real === 'string' && real) return real
  return 'unknown'
}
