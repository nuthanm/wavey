import { apiUrl } from './apiBase'
import { toWaveyError, WaveyError } from './errors'

export type ResolveResponse = {
  ok: true
  platform: 'youtube' | 'instagram'
  title: string
  creator: string
  duration: string
  durationSec: number
  thumbUrl: string | null
  thumbHue: number
  kindLabel: string
  mimeType: string
  filename: string
  token: string
  needsEncode?: boolean
  isStory?: boolean
  note?: string
}

export type ResolveError = {
  ok: false
  error: string
  code?: string
  hint?: string
}

async function readJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text.trim()) {
    throw toWaveyError(
      res.status === 502
        ? '502 bad gateway'
        : res.status >= 500
          ? `API unavailable (${res.status})`
          : 'Empty response from API',
      res.status,
    )
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw toWaveyError(
      res.status === 502 ? '502 bad gateway' : `API returned non-JSON (${res.status})`,
      res.status,
    )
  }
}

export async function resolveMedia(input: {
  url: string
  output: 'mp3' | 'mp4'
  quality: number
  signal?: AbortSignal
}): Promise<ResolveResponse> {
  let res: Response
  try {
    res = await fetch(apiUrl('/api/resolve'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: input.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw toWaveyError('Cannot reach /api/resolve — is the API on :8787 running?', 0)
  }

  const data = (await readJsonSafe(res)) as ResolveResponse | ResolveError
  if (!res.ok || !data || typeof data !== 'object' || !('ok' in data) || !data.ok) {
    const serverMsg =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Resolve failed (${res.status})`
    const err = toWaveyError(serverMsg, res.status)
    if (data && typeof data === 'object' && 'hint' in data && typeof data.hint === 'string') {
      err.hint = data.hint
    }
    throw err
  }
  return data
}

export function streamUrl(token: string): string {
  return apiUrl(`/api/stream?token=${encodeURIComponent(token)}`)
}

export async function downloadWithProgress(
  token: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; contentType: string }> {
  let res: Response
  try {
    res = await fetch(streamUrl(token), { signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw toWaveyError('Cannot reach /api/stream', 0)
  }

  if (!res.ok) {
    let message = `Download failed (${res.status})`
    try {
      const err = (await readJsonSafe(res)) as { error?: string }
      if (err && typeof err === 'object' && 'error' in err && err.error) {
        message = String(err.error)
      }
    } catch (e) {
      if (e instanceof WaveyError) throw e
    }
    throw toWaveyError(message, res.status)
  }

  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  const total = Number(res.headers.get('content-length') || 0)
  const reader = res.body?.getReader()
  if (!reader) {
    const blob = await res.blob()
    onProgress(100)
    return { blob, contentType }
  }

  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.byteLength
        if (total > 0) {
          onProgress(Math.min(95, Math.round((received / total) * 95)))
        } else {
          onProgress(Math.min(90, 10 + Math.round(Math.log10(received + 10) * 12)))
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw toWaveyError('download stream interrupted', res.status)
  }

  const blob = new Blob(chunks as BlobPart[], { type: contentType })
  onProgress(96)
  return { blob, contentType }
}
