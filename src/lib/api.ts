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

export async function resolveMedia(input: {
  url: string
  output: 'mp3' | 'mp4'
  quality: number
}): Promise<ResolveResponse> {
  const res = await fetch('/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = (await res.json()) as ResolveResponse | ResolveError
  if (!res.ok || !data.ok) {
    throw new Error(!data.ok ? data.error : `Resolve failed (${res.status})`)
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
  const res = await fetch(streamUrl(token))
  if (!res.ok) {
    let message = `Download failed (${res.status})`
    try {
      const err = (await res.json()) as { error?: string }
      if (err.error) message = err.error
    } catch {
      // ignore
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
