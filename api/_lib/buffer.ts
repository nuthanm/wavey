/** Collect a web ReadableStream into a Node Buffer (for stable one-shot HTTP responses). */
export async function streamToBuffer(
  stream: ReadableStream<Uint8Array>,
  maxBytes = 80 * 1024 * 1024,
): Promise<Buffer> {
  const reader = stream.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        throw new Error('File too large to buffer in memory — try a shorter clip or lower quality')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

export async function fetchToBuffer(
  url: string,
  headers: Record<string, string>,
  maxBytes = 80 * 1024 * 1024,
): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Upstream fetch failed (${res.status})`)
  if (!res.body) throw new Error('Upstream returned empty body')
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  const buffer = await streamToBuffer(res.body, maxBytes)
  return { buffer, contentType }
}
