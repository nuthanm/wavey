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
  /** High-res YouTube: download video+audio parts and remux in the browser */
  needsMux?: boolean
  actualQuality?: number
  availableHeights?: number[]
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

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (err instanceof DOMException && err.name === 'AbortError') return true
  const msg = err instanceof Error ? err.message : String(err || '')
  return /aborted|aborterror/i.test(msg)
}

/** XHR — more reliable than fetch for large binary + progress (extensions/HMR-safe). */
function xhrRequest(
  url: string,
  opts: {
    method?: string
    body?: string
    headers?: Record<string, string>
    signal?: AbortSignal
    onProgress?: (pct: number) => void
  } = {},
): Promise<{ status: number; body: ArrayBuffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(opts.method || 'GET', url, true)
    xhr.responseType = 'arraybuffer'
    xhr.timeout = 0
    for (const [k, v] of Object.entries(opts.headers || {})) {
      xhr.setRequestHeader(k, v)
    }

    const onAbort = () => {
      xhr.abort()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (opts.signal?.aborted) {
      onAbort()
      return
    }
    opts.signal?.addEventListener('abort', onAbort)

    xhr.onprogress = (e) => {
      if (!opts.onProgress) return
      if (e.lengthComputable && e.total > 0) {
        opts.onProgress(Math.min(95, Math.round((e.loaded / e.total) * 95)))
      } else if (e.loaded > 0) {
        opts.onProgress(Math.min(90, 10 + Math.round(Math.log10(e.loaded + 10) * 12)))
      }
    }

    xhr.onload = () => {
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({
        status: xhr.status,
        body: xhr.response as ArrayBuffer,
        contentType: xhr.getResponseHeader('content-type') || 'application/octet-stream',
      })
    }
    xhr.onerror = () => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(new TypeError('Failed to fetch'))
    }
    xhr.ontimeout = () => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(new TypeError('Failed to fetch'))
    }
    xhr.onabort = () => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    xhr.send(opts.body ?? null)
  })
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/health'), { cache: 'no-store' })
    if (!res.ok) return false
    const data = (await res.json()) as { ok?: boolean }
    return Boolean(data.ok)
  } catch {
    try {
      const xhr = await xhrRequest(apiUrl('/api/health'), { method: 'GET' })
      if (xhr.status < 200 || xhr.status >= 300) return false
      const text = new TextDecoder().decode(xhr.body)
      return text.includes('"ok":true')
    } catch {
      return false
    }
  }
}

export async function resolveMedia(input: {
  url: string
  output: 'mp3' | 'mp4'
  quality: number
  signal?: AbortSignal
}): Promise<ResolveResponse> {
  const url = apiUrl('/api/resolve')
  const body = JSON.stringify({
    url: input.url,
    output: input.output,
    quality: input.quality,
  })

  let data: ResolveResponse | ResolveError
  let status: number

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: input.signal,
      cache: 'no-store',
    })
    status = res.status
    data = (await readJsonSafe(res)) as ResolveResponse | ResolveError
  } catch (err) {
    if (isAbort(err, input.signal)) throw new DOMException('Aborted', 'AbortError')
    try {
      const xhr = await xhrRequest(url, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        signal: input.signal,
      })
      status = xhr.status
      const text = new TextDecoder().decode(xhr.body)
      data = JSON.parse(text) as ResolveResponse | ResolveError
    } catch (xhrErr) {
      if (isAbort(xhrErr, input.signal)) throw new DOMException('Aborted', 'AbortError')
      throw toWaveyError('Cannot reach /api/resolve', 0)
    }
  }

  if (!status || status >= 400 || !data || typeof data !== 'object' || !('ok' in data) || !data.ok) {
    const serverMsg =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Resolve failed (${status})`
    const mapped = toWaveyError(serverMsg, status)
    if (data && typeof data === 'object' && 'hint' in data && typeof data.hint === 'string') {
      mapped.hint = data.hint
    }
    throw mapped
  }
  return data
}

export function streamUrl(token: string, part?: 'video' | 'audio' | 'auto'): string {
  const base = apiUrl(`/api/stream?token=${encodeURIComponent(token)}`)
  if (!part || part === 'auto') return base
  return `${base}&part=${part}`
}

export async function downloadWithProgress(
  token: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
  part?: 'video' | 'audio' | 'auto',
): Promise<{ blob: Blob; contentType: string }> {
  const url = streamUrl(token, part)
  onProgress(5)

  // XHR first — survives Vite HMR noise better than fetch+arrayBuffer for big bodies
  try {
    const xhr = await xhrRequest(url, { method: 'GET', signal, onProgress })
    if (xhr.status < 200 || xhr.status >= 300) {
      const text = new TextDecoder().decode(xhr.body)
      let message = `Download failed (${xhr.status})`
      try {
        const parsed = JSON.parse(text) as { error?: string }
        if (parsed.error) message = parsed.error
      } catch {
        // ignore
      }
      throw toWaveyError(message, xhr.status)
    }
    if (!xhr.body || xhr.body.byteLength === 0) {
      throw toWaveyError('download stream interrupted / blocked by browser', 0)
    }
    onProgress(96)
    return {
      blob: new Blob([xhr.body], { type: xhr.contentType }),
      contentType: xhr.contentType,
    }
  } catch (err) {
    if (isAbort(err, signal)) throw new DOMException('Aborted', 'AbortError')
    if (err instanceof WaveyError) throw err

    // Fallback fetch
    try {
      const res = await fetch(url, { signal, cache: 'no-store' })
      if (!res.ok) {
        let message = `Download failed (${res.status})`
        try {
          const body = (await readJsonSafe(res)) as { error?: string }
          if (body?.error) message = String(body.error)
        } catch (e) {
          if (e instanceof WaveyError) throw e
        }
        throw toWaveyError(message, res.status)
      }
      onProgress(40)
      const buf = await res.arrayBuffer()
      if (!buf.byteLength) {
        throw toWaveyError('download stream interrupted / blocked by browser', 0)
      }
      onProgress(96)
      return {
        blob: new Blob([buf], {
          type: res.headers.get('content-type') || 'application/octet-stream',
        }),
        contentType: res.headers.get('content-type') || 'application/octet-stream',
      }
    } catch (fetchErr) {
      if (isAbort(fetchErr, signal)) throw new DOMException('Aborted', 'AbortError')
      if (fetchErr instanceof WaveyError) throw fetchErr
      throw toWaveyError('download stream interrupted / blocked by browser', 0)
    }
  }
}
