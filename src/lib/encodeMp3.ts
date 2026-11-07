import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpegPromise: Promise<FFmpeg> | null = null

async function getFfmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg()
      if (onLog) {
        ffmpeg.on('log', ({ message }) => onLog(message))
      }
      const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm'
      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      })
      return ffmpeg
    })().catch((err) => {
      ffmpegPromise = null
      throw err
    })
  }
  return ffmpegPromise
}

function extFromMime(mime: string, filename?: string): string {
  if (filename?.includes('.')) return filename.split('.').pop()!.toLowerCase()
  if (/webm/i.test(mime)) return 'webm'
  if (/mp4|m4a|aac/i.test(mime)) return 'm4a'
  if (/ogg|opus/i.test(mime)) return 'ogg'
  if (/mpeg|mp3/i.test(mime)) return 'mp3'
  return 'm4a'
}

/** Encode arbitrary audio/video blob to MP3 at the requested bitrate. */
export async function encodeToMp3(
  input: Blob,
  opts: {
    bitrateKbps: number
    contentType?: string
    filename?: string
    onProgress?: (pct: number) => void
  },
): Promise<Blob> {
  if (/audio\/mpeg|audio\/mp3/i.test(opts.contentType || input.type)) {
    opts.onProgress?.(100)
    return input
  }

  const ffmpeg = await getFfmpeg()
  opts.onProgress?.(5)

  ffmpeg.on('progress', ({ progress }) => {
    const pct = Math.max(5, Math.min(95, Math.round(progress * 100)))
    opts.onProgress?.(pct)
  })

  const inExt = extFromMime(opts.contentType || input.type, opts.filename)
  const inName = `input.${inExt}`
  const outName = 'output.mp3'

  await ffmpeg.writeFile(inName, await fetchFile(input))
  opts.onProgress?.(10)

  const bitrate = `${Math.max(64, Math.min(320, opts.bitrateKbps))}k`
  const code = await ffmpeg.exec([
    '-i',
    inName,
    '-vn',
    '-acodec',
    'libmp3lame',
    '-b:a',
    bitrate,
    outName,
  ])

  if (code !== 0) {
    throw new Error('MP3 encode failed in the browser')
  }

  const data = await ffmpeg.readFile(outName)
  await ffmpeg.deleteFile(inName).catch(() => undefined)
  await ffmpeg.deleteFile(outName).catch(() => undefined)
  opts.onProgress?.(100)

  const bytes =
    data instanceof Uint8Array
      ? data
      : new TextEncoder().encode(String(data))
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy.buffer], { type: 'audio/mpeg' })
}
