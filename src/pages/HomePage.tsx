import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  checkApiHealth,
  downloadWithProgress,
  resolveMedia,
  type ResolveResponse,
} from '../lib/api'
import { encodeToMp3 } from '../lib/encodeMp3'
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

type Mode = 'youtube' | 'instagram'
type OutputFormat = 'mp3' | 'mp4'
type IgKind = 'reel' | 'story'

const INSTAGRAM_ENABLED = false
type QualityId = 'chill' | 'clean' | 'cranked' | 'studio'
type VideoQualityId = 'hd' | 'fhd' | 'qhd' | 'uhd'

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
  { id: 'hd', name: 'HD', res: '720p', height: 720, blurb: 'fast save, still sharp' },
  { id: 'fhd', name: 'Full HD', res: '1080p', height: 1080, blurb: 'default flex quality' },
  { id: 'qhd', name: 'QHD', res: '1440p', height: 1440, blurb: 'crisp on big screens' },
  { id: 'uhd', name: '4K', res: '2160p', height: 2160, blurb: 'max video fidelity' },
]

function formatTime(sec: number) {
  if (!Number.isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fallbackMeta(_url: string, mode: Mode) {
  return {
    title: mode === 'youtube' ? 'paste a link to preview' : 'paste a reel or story',
    creator: '@wavey',
    duration: '—',
    thumbHue: mode === 'youtube' ? 80 : 300,
    thumbUrl: null as string | null,
    kindLabel: mode === 'youtube' ? 'YouTube' : 'Instagram',
  }
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
    url.trim().length > 8 &&
    status !== 'ripping' &&
    !resolving &&
    (detected === mode || detected === 'unknown')

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
    if (!toast) return
    const ms = toast.kind === 'err' ? 4200 : 2400
    const id = window.setTimeout(() => setToast(null), ms)
    return () => window.clearTimeout(id)
  }, [toast])

  // Debounced resolve for live preview (paused while a pull is in flight)
  useEffect(() => {
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
          // Preview/resolve as video — MP3 is extracted client-side from that file
          const qualityValue =
            outputFormat === 'mp3' ? 720 : selectedVideo.height
          const data = await resolveMedia({
            url: trimmed,
            output: 'mp4',
            quality: qualityValue,
            signal: controller.signal,
          })
          if (controller.signal.aborted) return
          setResolved(data)
          setFriendlyError(null)
          if (data.platform === 'instagram') {
            setIgKind(data.isStory || /story/i.test(data.kindLabel) ? 'story' : 'reel')
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
    if (next === 'instagram') setOutputFormat('mp4')
    audioRef.current?.pause()
    videoRef.current?.pause()
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
    if (mode === 'instagram') {
      if (outputFormat === 'mp3') return 'PULL AUDIO MP3'
      return igKind === 'story' ? 'SAVE THE STORY' : 'SAVE THE REEL'
    }
    return outputFormat === 'mp4' ? 'PULL TO MP4' : 'PULL TO MP3'
  }

  const activeMediaEl = () =>
    mediaKind === 'video' ? videoRef.current : audioRef.current

  const ripIt = async () => {
    if (!canRip) return
    if (detected && detected !== 'unknown' && detected !== mode) {
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
    setProgressLabel('resolving media…')

    try {
      // MP3 = download MP4 (works) → encode audio in the browser
      const resolveOutput = 'mp4' as const
      const qualityValue =
        outputFormat === 'mp3' ? 720 : selectedVideo.height
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
            ? 'grabbing video for mp3…'
            : 'grabbing video stream…',
      )

      const { blob, contentType } = await downloadWithProgress(
        data.token,
        (pct) => {
          setProgress(Math.max(8, Math.min(70, pct * 0.7)))
          setProgressLabel('downloading…')
        },
        pullAbort.signal,
      )

      let finalBlob = blob
      let kind: 'audio' | 'video' = 'video'

      if (outputFormat === 'mp3') {
        setProgress(72)
        setProgressLabel(`mp4 → mp3 @ ${selectedAudio.kbps}kbps…`)
        try {
          finalBlob = await encodeToMp3(blob, {
            bitrateKbps: selectedAudio.kbps,
            contentType,
            filename: data.filename,
            onProgress: (pct) => {
              setProgress(72 + Math.round(pct * 0.26))
            },
          })
        } catch (encodeErr) {
          throw toWaveyError(encodeErr instanceof Error ? encodeErr.message : 'mp3 encode failed')
        }
        kind = 'audio'
      } else if (!contentType.startsWith('video/') && contentType.startsWith('image/')) {
        throw new WaveyError('image_not_video')
      } else {
        kind = contentType.startsWith('video/') ? 'video' : 'audio'
      }

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
      const blob = readyBlob || (await fetch(mediaUrl).then((r) => r.blob()))
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
      <div className="rw-shell">
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
                Convert <strong>YouTube</strong> to clean <strong>MP3</strong> or
                high-quality <strong>MP4</strong>, and save{' '}
                Instagram reels soon. Built for phone,
                desktop, and webview — no sketchy redirects.
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

              <AnimatePresence>
                {friendlyError && (
                  <ErrorBanner
                    error={friendlyError}
                    onDismiss={() => setFriendlyError(null)}
                  />
                )}
              </AnimatePresence>

              <AnimatePresence>
                {url.trim().length > 8 && !friendlyError && (
                  <LinkPreview
                    data={{
                      platform: detected === 'unknown' || !detected ? mode : detected,
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
              {mode === 'youtube' ? (
                <motion.div
                  key="yt"
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

                  <h2 className="rw-section-title">
                    {outputFormat === 'mp4' ? 'pick the resolution' : 'pick the loudness'}
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
                    <div className="rw-qualities" role="group" aria-label="Resolution">
                      {VIDEO_QUALITIES.map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          className="rw-quality"
                          aria-pressed={videoQuality === q.id}
                          onClick={() => setVideoQuality(q.id)}
                        >
                          <strong>{q.name}</strong>
                          <em>{q.res}</em>
                          <span>{q.blurb}</span>
                        </button>
                      ))}
                    </div>
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
                            <span className="rw-tag">{selectedVideo.res}</span>
                          </>
                        ) : (
                          <>
                            <span className="rw-tag">{selectedAudio.name}</span>
                            <span className="rw-tag">{selectedAudio.kbps} kbps</span>
                          </>
                        )
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
                    setPlaying(false)
                    setResolved(null)
                    setFriendlyError(null)
                  }}
                >
                  PULL ANOTHER
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <p className="rw-footer-note">
            For personal, lawful use only — save media you own or have permission
            to keep. Not affiliated with YouTube, Google, Instagram, or Meta.
            Platform terms still apply. Stories need a server session cookie;
            public reels and YouTube links work without one.
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
  if (hasError) return null
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
        ? 'works with youtube + youtube music links'
        : 'paste a public reel — stories need IG_SESSIONID on the server'}
    </p>
  )
}
