import { createHmac, timingSafeEqual } from 'node:crypto'

export type StreamTokenPayload = {
  platform: 'youtube' | 'instagram'
  sourceUrl: string
  kind: 'audio' | 'video'
  /** bitrate kbps for audio, or height like 720/1080 for video */
  quality: number
  mediaUrl?: string
  mimeType?: string
  filename: string
  title: string
  exp: number
}

function secret(): string {
  const s = process.env.WAVEY_TOKEN_SECRET
  if (!s) {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      throw new Error('WAVEY_TOKEN_SECRET is not configured')
    }
    return 'wavey-dev-secret-change-me'
  }
  return s
}

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  return b.toString('base64url')
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url')
}

export function signToken(payload: Omit<StreamTokenPayload, 'exp'>, ttlSec = 600): string {
  const full: StreamTokenPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }
  const body = b64url(JSON.stringify(full))
  const sig = createHmac('sha256', secret()).update(body).digest()
  return `${body}.${b64url(sig)}`
}

export function verifyToken(token: string): StreamTokenPayload {
  const [body, sig] = token.split('.')
  if (!body || !sig) throw new Error('Invalid token')
  const expected = createHmac('sha256', secret()).update(body).digest()
  const actual = fromB64url(sig)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('Invalid token signature')
  }
  const payload = JSON.parse(fromB64url(body).toString('utf8')) as StreamTokenPayload
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired — resolve the link again')
  }
  return payload
}
