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
}

async function readJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text.trim()) {
    throw new Error(
      res.ok
        ? 'Empty response from API'
        : `API unavailable (${res.status}). Run npm run dev so the local API starts on port 8787.`,
    )
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(
      `API returned non-JSON (${res.status}). Is the Wavey API running? Use npm run dev (UI + API).`,
    )
  }
}

export async function resolveMedia(input: {
  url: string
  output: 'mp3' | 'mp4'
  quality: number
}): Promise<ResolveResponse> {
  let res: Response
  try {
    res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error(
      'Cannot reach /api/resolve. Start the app with npm run dev (starts UI + local API).',
    )
  }

  const data = (await readJsonSafe(res)) as ResolveResponse | ResolveError
  if (!res.ok || !data || typeof data !== 'object' || !('ok' in data) || !data.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Resolve failed (${res.status})`
    throw new Error(message)
  }
  return data
}

export function streamUrl(token: string): string {
  return `/api/stream?token=${encodeURIComponent(token)}`
}

export async function downloadWithProgress(
  token: string,
  onProgress: (pct: number) => void,
): Promise<{ blob: Blob; contentType: string }> {
  let res: Response
  try {
    res = await fetch(streamUrl(token))
  } catch {
    throw new Error('Cannot reach /api/stream. Is npm run dev still running?')
  }

  if (!res.ok) {
    let message = `Download failed (${res.status})`
    try {
      const err = (await readJsonSafe(res)) as { error?: string }
      if (err.error) message = err.error
    } catch (e) {
      if (e instanceof Error && !e.message.startsWith('Download')) message = e.message
    }
    throw new Error(message)
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

  const blob = new Blob(chunks as BlobPart[], { type: contentType })
  onProgress(96)
  return { blob, contentType }
}
