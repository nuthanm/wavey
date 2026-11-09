import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpegPromise: Promise<FFmpeg> | null = null

async function tryLoad(coreURL: string, wasmURL: string): Promise<FFmpeg> {
  const ffmpeg = new FFmpeg()
  await ffmpeg.load({
    coreURL: await toBlobURL(coreURL, 'text/javascript'),
    wasmURL: await toBlobURL(wasmURL, 'application/wasm'),
  })
  return ffmpeg
}

async function getFfmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const origin = window.location.origin
      const sources: Array<[string, string]> = [
        // Same-origin copy in /public/ffmpeg (see scripts/copy-ffmpeg.mjs)
        [`${origin}/ffmpeg/ffmpeg-core.js`, `${origin}/ffmpeg/ffmpeg-core.wasm`],
        [
          'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
          'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
        ],
        [
          'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
          'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
        ],
      ]

      let lastErr: unknown
      for (const [js, wasm] of sources) {
        try {
          return await tryLoad(js, wasm)
        } catch (err) {
          lastErr = err
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error('MP3 encoder failed to load')
    })()

    // Prevent unhandledrejection if load fails before the UI awaits it
    ffmpegPromise.catch(() => {
      ffmpegPromise = null
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
  if (/quicktime|mov/i.test(mime)) return 'mov'
  if (/matroska|mkv/i.test(mime)) return 'mkv'
  return 'm4a'
}

function extFromBlob(blob: Blob, filename?: string, fallback = 'bin'): string {
  if (filename?.includes('.')) return filename.split('.').pop()!.toLowerCase()
  const t = blob.type || ''
  if (/webm/i.test(t)) return 'webm'
  if (/mp4/i.test(t)) return 'mp4'
  if (/m4a|aac/i.test(t)) return 'm4a'
  if (/quicktime|mov/i.test(t)) return 'mov'
  if (/matroska|mkv/i.test(t)) return 'mkv'
  if (/ogg|opus/i.test(t)) return 'ogg'
  if (/mpeg|mp3/i.test(t)) return 'mp3'
  return fallback
}

async function readOutputBlob(ffmpeg: FFmpeg, outName: string, mime: string): Promise<Blob> {
  const data = await ffmpeg.readFile(outName)
  const bytes =
    data instanceof Uint8Array ? data : new TextEncoder().encode(String(data))
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy.buffer], { type: mime })
}

async function cleanup(ffmpeg: FFmpeg, names: string[]) {
  for (const name of names) {
    await ffmpeg.deleteFile(name).catch(() => undefined)
  }
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

  let ffmpeg: FFmpeg
  try {
    ffmpeg = await getFfmpeg()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      /failed to fetch/i.test(msg)
        ? 'MP3 encoder could not load — hard refresh and retry'
        : msg || 'MP3 encoder failed to load',
    )
  }

  opts.onProgress?.(5)

  ffmpeg.on('progress', ({ progress }) => {
    const pct = Math.max(5, Math.min(95, Math.round(progress * 100)))
    opts.onProgress?.(pct)
  })

  const inExt = extFromMime(opts.contentType || input.type, opts.filename)
  const inName = `input.${inExt}`
  const outName = 'output.mp3'
  const bitrate = `${Math.max(64, Math.min(320, opts.bitrateKbps))}k`

  await ffmpeg.writeFile(inName, await fetchFile(input))
  opts.onProgress?.(10)

  // Try a few arg sets — some inputs need explicit audio map / codec force
  const attempts: string[][] = [
    ['-i', inName, '-vn', '-acodec', 'libmp3lame', '-b:a', bitrate, outName],
    ['-i', inName, '-map', '0:a:0', '-acodec', 'libmp3lame', '-b:a', bitrate, outName],
    ['-i', inName, '-vn', '-ac', '2', '-ar', '44100', '-acodec', 'libmp3lame', '-b:a', bitrate, outName],
  ]

  let lastCode = 1
  for (const args of attempts) {
    lastCode = await ffmpeg.exec(args)
    if (lastCode === 0) break
    await ffmpeg.deleteFile(outName).catch(() => undefined)
  }

  if (lastCode !== 0) {
    await cleanup(ffmpeg, [inName, outName])
    throw new Error('MP3 encode failed in the browser — file may have no audio track')
  }

  const blob = await readOutputBlob(ffmpeg, outName, 'audio/mpeg')
  await cleanup(ffmpeg, [inName, outName])
  opts.onProgress?.(100)
  return blob
}

/**
 * Remux separate YouTube adaptive video + audio streams into one playable MP4.
 * Prefers stream copy; falls back to AAC audio encode when containers disagree.
 */
export async function muxToMp4(
  video: Blob,
  audio: Blob,
  opts: {
    videoName?: string
    audioName?: string
    onProgress?: (pct: number) => void
  } = {},
): Promise<Blob> {
  let ffmpeg: FFmpeg
  try {
    ffmpeg = await getFfmpeg()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      /failed to fetch/i.test(msg)
        ? 'Video muxer could not load — hard refresh and retry'
        : msg || 'Video muxer failed to load',
    )
  }

  opts.onProgress?.(5)
  ffmpeg.on('progress', ({ progress }) => {
    const pct = Math.max(5, Math.min(95, Math.round(progress * 100)))
    opts.onProgress?.(pct)
  })

  const vExt = extFromBlob(video, opts.videoName, 'mp4')
  const aExt = extFromBlob(audio, opts.audioName, 'm4a')
  const vName = `video.${vExt}`
  const aName = `audio.${aExt}`
  const outName = 'output.mp4'

  await ffmpeg.writeFile(vName, await fetchFile(video))
  opts.onProgress?.(12)
  await ffmpeg.writeFile(aName, await fetchFile(audio))
  opts.onProgress?.(20)

  const attempts: string[][] = [
    // Fast path: copy both (works when codecs fit MP4, e.g. avc1 + mp4a)
    [
      '-i',
      vName,
      '-i',
      aName,
      '-c',
      'copy',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-movflags',
      '+faststart',
      outName,
    ],
    // Re-encode audio to AAC when opus/webm audio won't sit in MP4
    [
      '-i',
      vName,
      '-i',
      aName,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-movflags',
      '+faststart',
      outName,
    ],
  ]

  let lastCode = 1
  for (const args of attempts) {
    lastCode = await ffmpeg.exec(args)
    if (lastCode === 0) break
    await ffmpeg.deleteFile(outName).catch(() => undefined)
  }

  if (lastCode !== 0) {
    await cleanup(ffmpeg, [vName, aName, outName])
    throw new Error('Could not merge video + audio into MP4')
  }

  const blob = await readOutputBlob(ffmpeg, outName, 'video/mp4')
  await cleanup(ffmpeg, [vName, aName, outName])
  opts.onProgress?.(100)
  return blob
}

/** Convert a local upload into MP4 (remux/transcode) for preview + download. */
export async function convertToMp4(
  input: Blob,
  opts: {
    filename?: string
    onProgress?: (pct: number) => void
  } = {},
): Promise<Blob> {
  const type = input.type || ''
  const name = opts.filename || ''
  if (/video\/mp4/i.test(type) || /\.mp4$/i.test(name)) {
    opts.onProgress?.(100)
    return input
  }

  let ffmpeg: FFmpeg
  try {
    ffmpeg = await getFfmpeg()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      /failed to fetch/i.test(msg)
        ? 'MP4 converter could not load — hard refresh and retry'
        : msg || 'MP4 converter failed to load',
    )
  }

  opts.onProgress?.(5)
  ffmpeg.on('progress', ({ progress }) => {
    const pct = Math.max(5, Math.min(95, Math.round(progress * 100)))
    opts.onProgress?.(pct)
  })

  const inExt = extFromBlob(input, opts.filename, 'bin')
  const inName = `input.${inExt}`
  const outName = 'output.mp4'

  await ffmpeg.writeFile(inName, await fetchFile(input))
  opts.onProgress?.(12)

  const attempts: string[][] = [
    ['-i', inName, '-c', 'copy', '-movflags', '+faststart', outName],
    [
      '-i',
      inName,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      outName,
    ],
  ]

  let lastCode = 1
  for (const args of attempts) {
    lastCode = await ffmpeg.exec(args)
    if (lastCode === 0) break
    await ffmpeg.deleteFile(outName).catch(() => undefined)
  }

  if (lastCode !== 0) {
    await cleanup(ffmpeg, [inName, outName])
    throw new Error('MP4 convert failed in the browser')
  }

  const blob = await readOutputBlob(ffmpeg, outName, 'video/mp4')
  await cleanup(ffmpeg, [inName, outName])
  opts.onProgress?.(100)
  return blob
}
