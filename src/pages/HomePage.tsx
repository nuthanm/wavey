import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  checkApiHealth,
  downloadWithProgress,
  resolveMedia,
  type ResolveResponse,
} from '../lib/api'
import { convertToMp4, encodeToMp3, muxToMp4 } from '../lib/encodeMp3'
import {
  friendlyFromUnknown,
  toWaveyError,
  type FriendlyError,
  WaveyError,
} from '../lib/errors'
import { detectSource } from '../lib/source'
import { ErrorBanner } from '../components/ErrorBanner'
import { LinkPreview } from '../components/LinkPreview'
import { RealisticWave } from '../components/RealisticWave'

type Mode = 'youtube' | 'instagram' | 'upload'
type OutputFormat = 'mp3' | 'mp4'
type IgKind = 'reel' | 'story'

const INSTAGRAM_ENABLED = false
type QualityId = 'chill' | 'clean' | 'cranked' | 'studio'
type VideoQualityId = 'sd' | 'nhd' | 'hd' | 'fhd' | 'qhd' | 'uhd'

const AUDIO_QUALITIES: Array<{
  id: QualityId
  name: string
  kbps: number
  blurb: string
}> = [
  { id: 'chill', name: 'Chill', kbps: 128, blurb: 'light files, still crisp' },
  { id: 'clean', name: 'Clean', kbps: 192, blurb: 'daily driver energy' },
  { id: 'cranked', name: 'Cranked', kbps: 320, blurb: 'max MP3 loudness' },
  { id: 'studio', name: 'Studio', kbps: 320, blurb: 'HQ master-ready vibe' },
]

const VIDEO_QUALITIES: Array<{
  id: VideoQualityId
  name: string
  res: string
  height: number
  blurb: string
}> = [
  { id: 'sd', name: 'SD', res: '360p', height: 360, blurb: 'tiny file, quick pull' },
  { id: 'nhd', name: '480p', res: '480p', height: 480, blurb: 'light + watchable' },
  { id: 'hd', name: 'HD', res: '720p', height: 720, blurb: 'fast save, still sharp' },
  { id: 'fhd', name: 'Full HD', res: '1080p', height: 1080, blurb: 'default flex quality' },
  { id: 'qhd', name: 'QHD', res: '1440p', height: 1440, blurb: 'crisp on big screens' },
  { id: 'uhd', name: '4K', res: '2160p', height: 2160, blurb: 'max video fidelity' },
]

const UPLOAD_ACCEPT =
  'video/*,audio/*,.mp4,.webm,.mov,.mkv,.m4a,.mp3,.ogg,.wav,.aac'

function formatTime(sec: number) {
  if (!Number.isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fallbackMeta(_url: string, mode: Mode) {
  return {
    title:
      mode === 'youtube'
        ? 'paste a link to preview'
        : mode === 'upload'
          ? 'drop a local video or audio file'
          : 'paste a reel or story',
    creator: '@wavey',
    duration: '—',
    thumbHue: mode === 'youtube' ? 80 : mode === 'upload' ? 160 : 300,
    thumbUrl: null as string | null,
    kindLabel: mode === 'youtube' ? 'YouTube' : mode === 'upload' ? 'Upload' : 'Instagram',
  }
}

function heightAvailable(available: number[] | undefined, height: number): boolean {
  if (!available?.length) return true
  return available.some((h) => h >= height - 16)
}

export function HomePage() {
  const [mode, setMode] = useState<Mode>('youtube')
  const [url, setUrl] = useState('')
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('mp3')
  const [igKind, setIgKind] = useState<IgKind>('reel')
  const [quality, setQuality] = useState<QualityId>('cranked')
  const [videoQuality, setVideoQuality] = useState<VideoQualityId>('fhd')
  const [status, setStatus] = useState<'idle' | 'ripping' | 'ready'>('idle')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('warming up…')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaKind, setMediaKind] = useState<'audio' | 'video'>('audio')
  const [readyBlob, setReadyBlob] = useState<Blob | null>(null)
  const [resolved, setResolved] = useState<ResolveResponse | null>(null)
  const [friendlyError, setFriendlyError] = useState<FriendlyError | null>(null)
  const [resolving, setResolving] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const [apiOnline, setApiOnline] = useState<boolean | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const showOk = (text: string) => setToast({ text, kind: 'ok' })
  const showErr = (err: unknown) => {
    const friendly = friendlyFromUnknown(err)
    setFriendlyError(friendly)
    setToast({ text: `${friendly.title} — ${friendly.message}`, kind: 'err' })
  }

  useEffect(() => {
    let cancelled = false
    const ping = async () => {
      const ok = await checkApiHealth()
      if (!cancelled) setApiOnline(ok)
    }
    void ping()
    const id = window.setInterval(() => void ping(), 8000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [audioNode, setAudioNode] = useState<HTMLAudioElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const detected = useMemo(() => (url.trim() ? detectSource(url.trim()) : null), [url])
  const selectedAudio = AUDIO_QUALITIES.find((q) => q.id === quality)!
  const selectedVideo = VIDEO_QUALITIES.find((q) => q.id === videoQuality)!

  const meta = resolved
    ? {
        title: resolved.title,
        creator: resolved.creator,
        duration: resolved.duration,
        thumbHue: resolved.thumbHue,
        thumbUrl: resolved.thumbUrl,
        kindLabel: resolved.kindLabel,
      }
    : fallbackMeta(url, mode)

  const canRip =
    status !== 'ripping' &&
    !resolving &&
    (mode === 'upload'
      ? Boolean(uploadFile)
      : url.trim().length > 8 && (detected === mode || detected === 'unknown'))

  // Only revoke blob URLs — never abort the active pull when mediaUrl changes
  useEffect(() => {
    return () => {
      if (mediaUrl) URL.revokeObjectURL(mediaUrl)
    }
  }, [mediaUrl])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (status !== 'ready') return
    const work = document.querySelector('.rw-work')
    work?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [status])

  useEffect(() => {
    if (!toast) return
    const ms = toast.kind === 'err' ? 4200 : 2400
    const id = window.setTimeout(() => setToast(null), ms)
    return () => window.clearTimeout(id)
  }, [toast])

  // Debounced resolve for live preview (paused while a pull is in flight)
  useEffect(() => {
    if (mode === 'upload') return
    const trimmed = url.trim()
    if (
      status === 'ripping' ||
      trimmed.length < 12 ||
      (detected && detected !== 'unknown' && detected !== mode)
    ) {
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        setResolving(true)
        setFriendlyError(null)
        try {
          const qualityValue =
            outputFormat === 'mp3' ? selectedAudio.kbps : selectedVideo.height
          const data = await resolveMedia({
            url: trimmed,
            output: outputFormat,
            quality: qualityValue,
            signal: controller.signal,
          })
          if (controller.signal.aborted) return
          setResolved(data)
          setFriendlyError(null)
          if (data.platform === 'instagram') {
            setIgKind(data.isStory || /story/i.test(data.kindLabel) ? 'story' : 'reel')
          }
          // Auto-pick closest available height when user asked for something missing
          if (
            outputFormat === 'mp4' &&
            data.availableHeights?.length &&
            !heightAvailable(data.availableHeights, selectedVideo.height)
          ) {
            const best = [...VIDEO_QUALITIES]
              .reverse()
              .find((q) => heightAvailable(data.availableHeights, q.height))
            if (best) setVideoQuality(best.id)
          }
        } catch (err) {
          // Chrome often reports aborted fetch as TypeError: Failed to fetch
          if (controller.signal.aborted) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          const msg = err instanceof Error ? err.message : String(err)
          if (/failed to fetch|networkerror|aborted/i.test(msg)) return
          setResolved(null)
          setFriendlyError(friendlyFromUnknown(err))
        } finally {
          if (!controller.signal.aborted) setResolving(false)
        }
      })()
    }, 650)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [url, mode, outputFormat, selectedAudio.kbps, selectedVideo.height, detected, status])

  const switchMode = (next: Mode) => {
    if (next === 'instagram' && !INSTAGRAM_ENABLED) return
    setMode(next)
    setStatus('idle')
    setProgress(0)
    setPlaying(false)
    setResolved(null)
    setFriendlyError(null)
    setUploadFile(null)
    if (next === 'instagram') setOutputFormat('mp4')
    audioRef.current?.pause()
    videoRef.current?.pause()
  }

  const onPickUpload = (file: File | null) => {
    if (!file) return
    setUploadFile(file)
    setUrl('')
    setResolved({
      ok: true,
      platform: 'youtube',
      title: file.name.replace(/\.[^.]+$/, '') || file.name,
      creator: '@local',
      duration: '—',
      durationSec: 0,
      thumbUrl: null,
      thumbHue: 160,
      kindLabel: 'Upload',
      mimeType: file.type || 'application/octet-stream',
      filename: file.name,
      token: '',
      needsEncode: outputFormat === 'mp3',
      needsMux: false,
    })
    setFriendlyError(null)
    setStatus('idle')
    showOk('file locked in')
  }

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setUrl(text.trim())
        const source = detectSource(text.trim())
        if (source === 'youtube') setMode('youtube')
        if (source === 'instagram' && INSTAGRAM_ENABLED) {
          setMode('instagram')
          setOutputFormat('mp4')
          if (/stories?\//i.test(text)) setIgKind('story')
          else setIgKind('reel')
        }
        showOk('link locked in')
      }
    } catch {
      showErr(new WaveyError('clipboard'))
    }
  }

  const ctaLabel = () => {
    if (status === 'ripping') return 'pulling…'
    if (mode === 'upload') {
      return outputFormat === 'mp4' ? 'CONVERT TO MP4' : 'CONVERT TO MP3'
    }
    if (mode === 'instagram') {
      if (outputFormat === 'mp3') return 'PULL AUDIO MP3'
      return igKind === 'story' ? 'SAVE THE STORY' : 'SAVE THE REEL'
    }
    return outputFormat === 'mp4' ? 'PULL TO MP4' : 'PULL TO MP3'
  }

  const activeMediaEl = () =>
    mediaKind === 'video' ? videoRef.current : audioRef.current

  const ripUpload = async (file: File, pullAbort: AbortController) => {
    setProgress(10)
    setProgressLabel('reading local file…')
    const inputBlob = file
    let finalBlob: Blob
    let kind: 'audio' | 'video'

    if (outputFormat === 'mp3') {
      setProgress(20)
      setProgressLabel(`encoding mp3 @ ${selectedAudio.kbps}kbps…`)
      finalBlob = await encodeToMp3(inputBlob, {
        bitrateKbps: selectedAudio.kbps,
        contentType: file.type,
        filename: file.name,
        onProgress: (pct) => setProgress(20 + Math.round(pct * 0.75)),
      })
      kind = 'audio'
    } else {
      setProgress(20)
      setProgressLabel('converting to mp4…')
      finalBlob = await convertToMp4(inputBlob, {
        filename: file.name,
        onProgress: (pct) => setProgress(20 + Math.round(pct * 0.75)),
      })
      kind = 'video'
    }

    if (pullAbort.signal.aborted) throw new DOMException('Aborted', 'AbortError')

    setResolved({
      ok: true,
      platform: 'youtube',
      title: file.name.replace(/\.[^.]+$/, '') || file.name,
      creator: '@local',
      duration: '—',
      durationSec: 0,
      thumbUrl: null,
      thumbHue: 160,
      kindLabel: 'Upload',
      mimeType: finalBlob.type,
      filename: file.name.replace(/\.[^.]+$/, outputFormat === 'mp3' ? '.mp3' : '.mp4'),
      token: '',
      needsEncode: false,
      needsMux: false,
    })

    return { finalBlob, kind }
  }

  const ripRemote = async (pullAbort: AbortController) => {
    const resolveOutput = outputFormat
    const qualityValue =
      outputFormat === 'mp3' ? selectedAudio.kbps : selectedVideo.height
    const data = await resolveMedia({
      url: url.trim(),
      output: resolveOutput,
      quality: qualityValue,
      signal: pullAbort.signal,
    })
    setResolved(data)

    setProgress(8)
    setProgressLabel(
      mode === 'instagram'
        ? igKind === 'story'
          ? 'opening story…'
          : 'opening reel…'
        : outputFormat === 'mp3'
          ? 'grabbing audio stream…'
          : data.needsMux
            ? 'grabbing adaptive video + audio…'
            : 'grabbing video stream…',
    )

    let finalBlob: Blob
    let kind: 'audio' | 'video'
    let contentType: string

    if (outputFormat === 'mp4' && data.needsMux) {
      // High-res YouTube: separate streams → remux in browser (the reliable path)
      const [videoPart, audioPart] = await Promise.all([
        downloadWithProgress(
          data.token,
          (pct) => {
            setProgress(Math.max(8, Math.min(40, 8 + pct * 0.32)))
            setProgressLabel('downloading video…')
          },
          pullAbort.signal,
          'video',
        ),
        downloadWithProgress(
          data.token,
          (pct) => {
            setProgress(Math.max(40, Math.min(68, 40 + pct * 0.28)))
            setProgressLabel('downloading audio…')
          },
          pullAbort.signal,
          'audio',
        ),
      ])

      setProgress(70)
      setProgressLabel('merging video + audio…')
      try {
        finalBlob = await muxToMp4(videoPart.blob, audioPart.blob, {
          videoName: data.filename,
          audioName: data.filename.replace(/\.mp4$/i, '.m4a'),
          onProgress: (pct) => setProgress(70 + Math.round(pct * 0.28)),
        })
      } catch (muxErr) {
        throw toWaveyError(
          muxErr instanceof Error ? muxErr.message : 'Could not merge video + audio into MP4',
        )
      }
      kind = 'video'
      contentType = 'video/mp4'
    } else {
      const part = outputFormat === 'mp3' ? ('auto' as const) : ('auto' as const)
      const downloaded = await downloadWithProgress(
        data.token,
        (pct) => {
          setProgress(Math.max(8, Math.min(70, pct * 0.7)))
          setProgressLabel('downloading…')
        },
        pullAbort.signal,
        part,
      )
      contentType = downloaded.contentType

      if (outputFormat === 'mp3') {
        setProgress(72)
        setProgressLabel(`encoding mp3 @ ${selectedAudio.kbps}kbps…`)
        try {
          finalBlob = await encodeToMp3(downloaded.blob, {
            bitrateKbps: selectedAudio.kbps,
            contentType,
            filename: data.filename,
            onProgress: (pct) => setProgress(72 + Math.round(pct * 0.26)),
          })
        } catch (encodeErr) {
          throw toWaveyError(
            encodeErr instanceof Error ? encodeErr.message : 'mp3 encode failed',
          )
        }
        kind = 'audio'
      } else if (!contentType.startsWith('video/') && contentType.startsWith('image/')) {
        throw new WaveyError('image_not_video')
      } else {
        finalBlob = downloaded.blob
        kind = contentType.startsWith('video/') ? 'video' : 'audio'
      }
    }

    return { finalBlob, kind }
  }

  const ripIt = async () => {
    if (!canRip) return
    if (mode !== 'upload' && detected && detected !== 'unknown' && detected !== mode) {
      showErr(new WaveyError('wrong_platform'))
      return
    }

    abortRef.current?.abort()
    const pullAbort = new AbortController()
    abortRef.current = pullAbort
    if (mediaUrl) URL.revokeObjectURL(mediaUrl)
    setMediaUrl(null)
    setReadyBlob(null)
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
    setFriendlyError(null)
    setStatus('ripping')
    setProgress(2)
    setProgressLabel(mode === 'upload' ? 'preparing convert…' : 'resolving media…')

    try {
      const { finalBlob, kind } =
        mode === 'upload' && uploadFile
          ? await ripUpload(uploadFile, pullAbort)
          : await ripRemote(pullAbort)

      const objectUrl = URL.createObjectURL(finalBlob)
      setMediaUrl(objectUrl)
      setReadyBlob(finalBlob)
      setMediaKind(kind)
      setProgress(100)
      setProgressLabel('locked. play anywhere.')
      setStatus('ready')
      showOk(
        mode === 'instagram'
          ? igKind === 'story'
            ? 'story ready'
            : 'reel ready'
          : mode === 'upload'
            ? outputFormat === 'mp4'
              ? 'mp4 ready'
              : 'mp3 ready'
            : outputFormat === 'mp4'
              ? 'mp4 ready'
              : 'mp3 ready',
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus('idle')
        setProgress(0)
        return
      }
      setStatus('idle')
      setProgress(0)
      showErr(err)
    }
  }

  const togglePlay = async () => {
    const el = activeMediaEl()
    if (!el || !mediaUrl) return
    if (el.paused) {
      await el.play()
      setPlaying(true)
    } else {
      el.pause()
      setPlaying(false)
    }
  }

  const downloadFile = () => {
    if (!mediaUrl) return
    const a = document.createElement('a')
    a.href = mediaUrl
    const ext = outputFormat === 'mp4' ? 'mp4' : 'mp3'
    a.download =
      resolved?.filename?.replace(/\.[^.]+$/, `.${ext}`) ||
      (mode === 'youtube'
        ? outputFormat === 'mp4'
          ? `wavey-${selectedVideo.res}.${ext}`
          : `wavey-${quality}-${selectedAudio.kbps}kbps.${ext}`
        : mode === 'upload'
          ? `wavey-upload.${ext}`
          : `wavey-${igKind}.${ext}`)
    a.click()
    showOk(`${ext} download started`)
  }

  const shareFile = async () => {
    if (!mediaUrl || !navigator.share) {
      showErr(new WaveyError('share_unsupported'))
      return
    }
    try {
      const blob: Blob = readyBlob ?? (await fetch(mediaUrl).then((r) => r.blob()))
      const file = new File([blob], `wavey.${outputFormat}`, {
        type: outputFormat === 'mp4' ? 'video/mp4' : 'audio/mpeg',
      })
      await navigator.share({
        title: 'Wavey',
        text: meta.title,
        files: [file],
      })
    } catch {
      showErr(new WaveyError('share_cancel'))
    }
  }

  /** Already have MP4? Strip audio → MP3 without re-downloading. */
  const convertReadyVideoToMp3 = async () => {
    if (!readyBlob || mediaKind !== 'video') return
    setFriendlyError(null)
    setStatus('ripping')
    setProgress(72)
    setProgressLabel(`mp4 → mp3 @ ${selectedAudio.kbps}kbps…`)
    try {
      const mp3 = await encodeToMp3(readyBlob, {
        bitrateKbps: selectedAudio.kbps,
        contentType: 'video/mp4',
        filename: resolved?.filename || 'video.mp4',
        onProgress: (pct) => setProgress(72 + Math.round(pct * 0.26)),
      })
      if (mediaUrl) URL.revokeObjectURL(mediaUrl)
      const objectUrl = URL.createObjectURL(mp3)
      setMediaUrl(objectUrl)
      setReadyBlob(mp3)
      setMediaKind('audio')
      setOutputFormat('mp3')
      setPlaying(false)
      setCurrent(0)
      setProgress(100)
      setProgressLabel('locked. play anywhere.')
      setStatus('ready')
      showOk('mp3 ready')
    } catch (err) {
      setStatus('ready')
      setProgress(100)
      showErr(err)
    }
  }

  return (
    <>
      <div className={`rw-shell${status === 'ready' ? ' is-ready' : ''}`}>
        <section className="rw-brand-panel">
          <div>
            <div className="rw-topbar">
              <a className="rw-logo" href="/" aria-label="Wavey home">
                <span className="rw-logo-mark">WY</span>
                <span className="rw-logo-text">Wavey</span>
              </a>
              <div className="rw-top-actions">
                <Link className="rw-nav-link" to="/how-it-works">
                  How it works
                </Link>
                <span
                  className={`rw-pill ${apiOnline === false ? 'is-down' : ''}`}
                  title={
                    apiOnline === false
                      ? 'convert api offline — restart npm run dev'
                      : 'convert api reachable'
                  }
                >
                  {apiOnline === false ? 'api offline' : apiOnline ? 'api live' : 'checking…'}
                </span>
              </div>
            </div>

            <div className="rw-hero-copy">
              <h1>
                drop the link.
                <br />
                <span>catch the vibe.</span>
              </h1>
              <p className="rw-hero-lead">
                Convert <strong>YouTube</strong> or a <strong>local file</strong> to
                clean <strong>MP3</strong> or high-quality <strong>MP4</strong> at
                any resolution you pick. Built for phone, desktop, and webview —
                no sketchy redirects.
              </p>
              <div className="rw-trust-row" aria-label="Trust signals">
                <span className="rw-trust-chip">No account needed</span>
                <span className="rw-trust-chip">HQ audio + video</span>
                <span className="rw-trust-chip">Mobile + desktop ready</span>
              </div>
            </div>

            <div className="rw-stat-row">
              <div className="rw-stat">
                <strong>MP3/4</strong>
                <span>dual format</span>
              </div>
              <div className="rw-stat">
                <strong>Reels</strong>
                <span>+ stories</span>
              </div>
              <div className="rw-stat">
                <strong>HQ</strong>
                <span>play anywhere</span>
              </div>
            </div>
          </div>
        </section>

        <section className="rw-work">
          <div className="rw-card">
            <div className="rw-modes" role="tablist" aria-label="Source">
              <button
                className="rw-mode"
                role="tab"
                aria-pressed={mode === 'youtube'}
                onClick={() => switchMode('youtube')}
              >
                YouTube
              </button>
              <button
                className="rw-mode"
                role="tab"
                aria-pressed={mode === 'upload'}
                onClick={() => switchMode('upload')}
              >
                Upload
              </button>
              <button
                className={`rw-mode${!INSTAGRAM_ENABLED ? ' is-soon' : ''}`}
                role="tab"
                aria-pressed={mode === 'instagram'}
                aria-disabled={!INSTAGRAM_ENABLED}
                disabled={!INSTAGRAM_ENABLED}
                title={!INSTAGRAM_ENABLED ? 'Instagram coming soon' : undefined}
                onClick={() => switchMode('instagram')}
              >
                <span>Instagram</span>
                {!INSTAGRAM_ENABLED && (
                  <span className="rw-soon-tag" aria-hidden="true">
                    coming soon
                  </span>
                )}
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              {mode === 'upload' ? (
                <>
                  <label className="rw-label" htmlFor="rip-upload">
                    upload video or audio
                  </label>
                  <input
                    ref={fileInputRef}
                    id="rip-upload"
                    className="rw-file-input"
                    type="file"
                    accept={UPLOAD_ACCEPT}
                    onChange={(e) => onPickUpload(e.target.files?.[0] || null)}
                  />
                  <button
                    type="button"
                    className={`rw-dropzone${uploadFile ? ' has-file' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'copy'
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const file = e.dataTransfer.files?.[0]
                      if (file) onPickUpload(file)
                    }}
                  >
                    {uploadFile ? (
                      <>
                        <strong>{uploadFile.name}</strong>
                        <span>
                          {(uploadFile.size / (1024 * 1024)).toFixed(1)} MB · tap to swap
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>Drop a file here</strong>
                        <span>or tap to browse · mp4, webm, mov, mkv, mp3, m4a…</span>
                      </>
                    )}
                  </button>
                  <p className="rw-hint ok">
                    converts entirely in your browser — nothing uploaded to a server
                  </p>
                </>
              ) : (
                <>
                  <label className="rw-label" htmlFor="rip-url">
                    paste link
                  </label>
                  <div className="rw-input-wrap">
                    <input
                      id="rip-url"
                      className="rw-input"
                      value={url}
                      onChange={(e) => {
                        const next = e.target.value
                        setUrl(next)
                        setStatus('idle')
                        setResolved(null)
                        setFriendlyError(null)
                        if (INSTAGRAM_ENABLED && /instagram\.com\/stories?\//i.test(next)) {
                          setMode('instagram')
                          setIgKind('story')
                          setOutputFormat('mp4')
                        } else if (
                          INSTAGRAM_ENABLED &&
                          /instagram\.com\/(reel|reels)\//i.test(next)
                        ) {
                          setMode('instagram')
                          setIgKind('reel')
                          setOutputFormat('mp4')
                        }
                      }}
                      placeholder={
                        mode === 'youtube'
                          ? 'https://youtube.com/watch?v=…'
                          : igKind === 'story'
                            ? 'https://instagram.com/stories/…'
                            : 'https://instagram.com/reel/…'
                      }
                      inputMode="url"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="rw-paste"
                      onClick={pasteFromClipboard}
                      aria-label="Paste from clipboard"
                      title="Paste"
                    >
                      ⎘
                    </button>
                  </div>
                  {detectingHint(detected, mode, resolving, Boolean(friendlyError))}
                </>
              )}

              <AnimatePresence>
                {friendlyError && (
                  <ErrorBanner
                    error={friendlyError}
                    onDismiss={() => setFriendlyError(null)}
                  />
                )}
              </AnimatePresence>

              <AnimatePresence>
                {mode !== 'upload' && url.trim().length > 8 && !friendlyError && (
                  <LinkPreview
                    data={{
                      platform:
                        detected === 'unknown' || !detected
                          ? mode === 'instagram'
                            ? 'instagram'
                            : 'youtube'
                          : detected,
                      title: resolving ? 'resolving…' : meta.title,
                      creator: meta.creator,
                      duration: meta.duration,
                      url: url.trim(),
                      thumbHue: meta.thumbHue,
                      thumbUrl: meta.thumbUrl,
                      kindLabel: meta.kindLabel,
                    }}
                  />
                )}
              </AnimatePresence>
            </div>

            <AnimatePresence mode="wait">
              {mode === 'youtube' || mode === 'upload' ? (
                <motion.div
                  key={mode === 'upload' ? 'up' : 'yt'}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <h2 className="rw-section-title">output format</h2>
                  <div className="rw-seg" role="group" aria-label="Format">
                    <button
                      type="button"
                      className="rw-seg-btn"
                      aria-pressed={outputFormat === 'mp3'}
                      onClick={() => setOutputFormat('mp3')}
                    >
                      <strong>MP3</strong>
                      <span>audio only</span>
                    </button>
                    <button
                      type="button"
                      className="rw-seg-btn"
                      aria-pressed={outputFormat === 'mp4'}
                      onClick={() => setOutputFormat('mp4')}
                    >
                      <strong>MP4</strong>
                      <span>full video</span>
                    </button>
                  </div>

                  {mode === 'upload' ? (
                    <p className="rw-hint" style={{ marginTop: 12 }}>
                      {outputFormat === 'mp3'
                        ? 'Pulls the audio track from your file and encodes MP3 locally.'
                        : 'Keeps MP4 as-is when possible, or remuxes/transcodes other video containers.'}
                    </p>
                  ) : (
                    <>
                      <h2 className="rw-section-title">
                        {outputFormat === 'mp4'
                          ? 'pick the resolution'
                          : 'pick the loudness'}
                      </h2>
                      {outputFormat === 'mp3' ? (
                        <div className="rw-qualities" role="group" aria-label="Bitrate">
                          {AUDIO_QUALITIES.map((q) => (
                            <button
                              key={q.id}
                              type="button"
                              className="rw-quality"
                              aria-pressed={quality === q.id}
                              onClick={() => setQuality(q.id)}
                            >
                              <strong>{q.name}</strong>
                              <em>{q.kbps} kbps</em>
                              <span>{q.blurb}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <>
                          <div
                            className="rw-qualities"
                            role="group"
                            aria-label="Resolution"
                          >
                            {VIDEO_QUALITIES.map((q) => {
                              const available = heightAvailable(
                                resolved?.availableHeights,
                                q.height,
                              )
                              return (
                                <button
                                  key={q.id}
                                  type="button"
                                  className={`rw-quality${!available ? ' is-dim' : ''}`}
                                  aria-pressed={videoQuality === q.id}
                                  title={
                                    available
                                      ? q.blurb
                                      : 'not listed for this video — we’ll fall back to the next best'
                                  }
                                  onClick={() => setVideoQuality(q.id)}
                                >
                                  <strong>{q.name}</strong>
                                  <em>{q.res}</em>
                                  <span>
                                    {available
                                      ? q.height > 720
                                        ? 'adaptive merge'
                                        : q.blurb
                                      : 'fallback if missing'}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                          {resolved?.needsMux && (
                            <p className="rw-hint ok">
                              1080p+ downloads as separate video + audio, then merges in
                              your browser so the file has sound.
                            </p>
                          )}
                        </>
                      )}
                    </>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="ig"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <h2 className="rw-section-title">what are you saving?</h2>
                  <div className="rw-seg" role="group" aria-label="Instagram type">
                    <button
                      type="button"
                      className="rw-seg-btn"
                      aria-pressed={igKind === 'reel'}
                      onClick={() => setIgKind('reel')}
                    >
                      <strong>Reels</strong>
                      <span>public clips</span>
                    </button>
                    <button
                      type="button"
                      className="rw-seg-btn"
                      aria-pressed={igKind === 'story'}
                      onClick={() => setIgKind('story')}
                    >
                      <strong>Stories</strong>
                      <span>needs session env</span>
                    </button>
                  </div>

                  <h2 className="rw-section-title">export as</h2>
                  <div className="rw-seg" role="group" aria-label="Instagram format">
                    <button
                      type="button"
                      className="rw-seg-btn"
                      aria-pressed={outputFormat === 'mp4'}
                      onClick={() => setOutputFormat('mp4')}
                    >
                      <strong>MP4</strong>
                      <span>as posted</span>
                    </button>
                    <button
                      type="button"
                      className="rw-seg-btn"
                      aria-pressed={outputFormat === 'mp3'}
                      onClick={() => setOutputFormat('mp3')}
                    >
                      <strong>MP3</strong>
                      <span>audio pull</span>
                    </button>
                  </div>

                  <h2 className="rw-section-title">as Instagram served it</h2>
                  <p className="rw-hint" style={{ marginTop: 0 }}>
                    Effects, captions, and audio are baked into the file Instagram
                    hosts. Wavey saves that stream as-is — no separate strip/flatten
                    pass.
                  </p>
                  {igKind === 'story' && (
                    <p className="rw-hint warn">
                      Stories need <code>IG_SESSIONID</code> on the server. Public
                      reels work without login. Expired or private stories will fail.
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="button"
              className="rw-cta"
              disabled={!canRip}
              onClick={() => void ripIt()}
            >
              {ctaLabel()}
              <span aria-hidden>↗</span>
            </button>

            {status === 'ripping' && (
              <div className="rw-progress" aria-live="polite">
                <div className="rw-progress-top">
                  <span>{progressLabel}</span>
                  <strong>{progress}%</strong>
                </div>
                <div className="rw-bar">
                  <i style={{ width: `${progress}%` }} />
                </div>
                <RealisticWave mode="progress" active className="rw-progress-wave" />
              </div>
            )}
          </div>

          <AnimatePresence>
            {status === 'ready' && mediaUrl && (
              <motion.div
                className="rw-card rw-result"
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ type: 'spring', stiffness: 280, damping: 24 }}
              >
                <div className="rw-meta">
                  <div
                    className={`rw-thumb ${mediaKind === 'video' ? 'is-video' : ''}`}
                    style={{ ['--hue' as string]: meta.thumbHue }}
                    aria-hidden
                  >
                    {meta.thumbUrl ? (
                      <img
                        src={meta.thumbUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                  </div>
                  <div>
                    <h3>{meta.title}</h3>
                    <p>
                      {meta.creator} · {meta.duration}
                      {mode === 'instagram' ? ` · ${igKind}` : ''}
                    </p>
                    <div className="rw-tags">
                      <span className="rw-tag">{outputFormat.toUpperCase()}</span>
                      {mode === 'youtube' ? (
                        outputFormat === 'mp4' ? (
                          <>
                            <span className="rw-tag">{selectedVideo.name}</span>
                            <span className="rw-tag">
                              {resolved?.actualQuality
                                ? `${resolved.actualQuality}p`
                                : selectedVideo.res}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="rw-tag">{selectedAudio.name}</span>
                            <span className="rw-tag">{selectedAudio.kbps} kbps</span>
                          </>
                        )
                      ) : mode === 'upload' ? (
                        <span className="rw-tag">local file</span>
                      ) : (
                        <>
                          <span className="rw-tag">{igKind}</span>
                          <span className="rw-tag">as served</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rw-player">
                  {mediaKind === 'video' ? (
                    <video
                      ref={videoRef}
                      className="rw-video"
                      src={mediaUrl}
                      playsInline
                      controls={false}
                      preload="metadata"
                      onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                      onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
                      onEnded={() => setPlaying(false)}
                      onPause={() => setPlaying(false)}
                      onPlay={() => setPlaying(true)}
                    />
                  ) : (
                    <RealisticWave
                      audioEl={audioNode}
                      active={playing || status === 'ready'}
                      mode="player"
                    />
                  )}

                  <div className="rw-player-controls">
                    <button
                      type="button"
                      className="rw-play"
                      onClick={() => void togglePlay()}
                      aria-label={playing ? 'Pause' : 'Play'}
                    >
                      {playing ? '❚❚' : '▶'}
                    </button>
                    <input
                      className="rw-seek"
                      type="range"
                      min={0}
                      max={duration || 1}
                      step={0.01}
                      value={current}
                      onChange={(e) => {
                        const next = Number(e.target.value)
                        setCurrent(next)
                        const el = activeMediaEl()
                        if (el) el.currentTime = next
                      }}
                    />
                    <div className="rw-time">
                      {formatTime(current)} / {formatTime(duration || 0)}
                    </div>
                  </div>

                  {mediaKind === 'audio' && (
                    <audio
                      ref={(el) => {
                        audioRef.current = el
                        if (el !== audioNode) setAudioNode(el)
                      }}
                      src={mediaUrl}
                      preload="metadata"
                      onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                      onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
                      onEnded={() => setPlaying(false)}
                      onPause={() => setPlaying(false)}
                      onPlay={() => setPlaying(true)}
                    />
                  )}
                </div>

                <div className="rw-actions">
                  <button type="button" className="rw-btn primary" onClick={downloadFile}>
                    Download {outputFormat.toUpperCase()}
                  </button>
                  {mediaKind === 'video' && (
                    <button
                      type="button"
                      className="rw-btn"
                      onClick={() => void convertReadyVideoToMp3()}
                    >
                      Convert to MP3
                    </button>
                  )}
                  <button type="button" className="rw-btn" onClick={() => void shareFile()}>
                    Share
                  </button>
                </div>
                <button
                  type="button"
                  className="rw-cta"
                  onClick={() => {
                    setStatus('idle')
                    setUrl('')
                    setUploadFile(null)
                    setPlaying(false)
                    setResolved(null)
                    setFriendlyError(null)
                    setReadyBlob(null)
                    if (mediaUrl) URL.revokeObjectURL(mediaUrl)
                    setMediaUrl(null)
                  }}
                >
                  {mode === 'upload' ? 'CONVERT ANOTHER' : 'PULL ANOTHER'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <p className="rw-footer-note">
            For personal, lawful use only — save media you own or have permission
            to keep. Not affiliated with YouTube, Google, Instagram, or Meta.
            Platform terms still apply. Local uploads convert in your browser;
            YouTube 1080p+ is merged client-side so audio stays in the file.
          </p>
        </section>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            className={`rw-toast ${toast.kind === 'err' ? 'is-error' : ''}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function detectingHint(
  detected: ReturnType<typeof detectSource> | null,
  mode: Mode,
  resolving: boolean,
  hasError: boolean,
) {
  if (hasError || mode === 'upload') return null
  if (resolving) return <p className="rw-hint ok">locking the vibe…</p>
  if (detected && detected !== 'unknown' && detected !== mode) {
    return (
      <p className="rw-hint warn">
        that url looks like {detected}. switch tab or keep typing.
      </p>
    )
  }
  if (detected === mode) {
    return <p className="rw-hint ok">source locked · looking good</p>
  }
  return (
    <p className="rw-hint">
      {mode === 'youtube'
        ? 'works with youtube + youtube music links · any resolution'
        : 'paste a public reel — stories need IG_SESSIONID on the server'}
    </p>
  )
}
