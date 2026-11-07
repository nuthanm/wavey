import { useEffect, useRef } from 'react'

type Props = {
  audioEl?: HTMLAudioElement | null
  active?: boolean
  mode?: 'player' | 'progress' | 'pill'
  className?: string
}

function sampleWave(
  i: number,
  n: number,
  t: number,
  live: Float32Array | null,
  active: boolean,
) {
  if (live && live.length) {
    const idx = Math.floor((i / (n - 1)) * (live.length - 1))
    const a = live[idx] ?? 0
    const b = live[Math.min(live.length - 1, idx + 1)] ?? a
    const f = ((i / (n - 1)) * (live.length - 1)) % 1
    return a * (1 - f) + b * f
  }

  const x = i / (n - 1)
  const center = 1 - Math.abs(x - 0.5) * 1.6
  const envelope = Math.max(0.15, center)
  const motion = active
    ? Math.sin(t * 2.8 + x * 10.5) * 0.38 +
      Math.sin(t * 4.6 + x * 17.2) * 0.22 +
      Math.sin(t * 7.1 + x * 4.4) * 0.12
    : Math.sin(t * 1.2 + x * 6) * 0.08
  return Math.max(-1, Math.min(1, envelope * motion))
}

/**
 * Continuous oscilloscope-style ribbon — not equalizer bars.
 */
export function RealisticWave({
  audioEl = null,
  active = true,
  mode = 'player',
  className = '',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxAudioRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const timeDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const smoothRef = useRef<Float32Array | null>(null)

  useEffect(() => {
    if (!audioEl) return

    const ensureGraph = async () => {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      if (!ctxAudioRef.current) ctxAudioRef.current = new AC()
      const ctx = ctxAudioRef.current
      if (ctx.state === 'suspended') await ctx.resume()

      if (!analyserRef.current) {
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        analyser.smoothingTimeConstant = 0.75
        analyserRef.current = analyser
        timeDataRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize))
      }

      if (!sourceRef.current) {
        try {
          const source = ctx.createMediaElementSource(audioEl)
          source.connect(analyserRef.current!)
          analyserRef.current!.connect(ctx.destination)
          sourceRef.current = source
        } catch {
          // already wired
        }
      }
    }

    void ensureGraph()
  }, [audioEl])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const start = performance.now()
    const points = mode === 'pill' ? 48 : mode === 'progress' ? 96 : 128

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const { width, height } = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (!smoothRef.current || smoothRef.current.length !== points) {
        smoothRef.current = new Float32Array(points)
      }
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const draw = (now: number) => {
      const t = (now - start) / 1000
      const { width, height } = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, width, height)

      const n = points
      const smooth = smoothRef.current!
      const playing = Boolean(active && audioEl && !audioEl.paused)
      let live: Float32Array | null = null

      if (playing && analyserRef.current && timeDataRef.current) {
        analyserRef.current.getByteTimeDomainData(timeDataRef.current)
        const raw = timeDataRef.current
        live = new Float32Array(n)
        for (let i = 0; i < n; i++) {
          const idx = Math.floor((i / (n - 1)) * (raw.length - 1))
          live[i] = (raw[idx] - 128) / 128
        }
      }

      for (let i = 0; i < n; i++) {
        const target = sampleWave(i, n, t, live, active)
        smooth[i] += (target - smooth[i]) * (playing ? 0.45 : 0.14)
      }

      const midY = height * 0.5
      const amp = height * (mode === 'pill' ? 0.36 : 0.4)
      const step = width / (n - 1)

      const buildPath = () => {
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          const x = i * step
          const y = midY + smooth[i] * amp
          if (i === 0) ctx.moveTo(x, y)
          else {
            const x0 = (i - 1) * step
            const y0 = midY + smooth[i - 1] * amp
            const cpx = (x0 + x) / 2
            ctx.quadraticCurveTo(x0, y0, cpx, (y0 + y) / 2)
            if (i === n - 1) ctx.lineTo(x, y)
          }
        }
      }

      // Glow fill under the ribbon
      buildPath()
      const lastX = (n - 1) * step
      ctx.lineTo(lastX, midY)
      ctx.lineTo(0, midY)
      ctx.closePath()
      const fill = ctx.createLinearGradient(0, 0, 0, height)
      fill.addColorStop(0, 'rgba(212,255,0,0.22)')
      fill.addColorStop(0.5, 'rgba(92,225,255,0.10)')
      fill.addColorStop(1, 'rgba(212,255,0,0.18)')
      ctx.fillStyle = fill
      ctx.fill()

      // Soft outer glow stroke
      buildPath()
      ctx.strokeStyle = 'rgba(212,255,0,0.28)'
      ctx.lineWidth = mode === 'pill' ? 5 : 7
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke()

      // Crisp core stroke
      buildPath()
      const stroke = ctx.createLinearGradient(0, 0, width, 0)
      stroke.addColorStop(0, '#d4ff00')
      stroke.addColorStop(0.5, '#5ce1ff')
      stroke.addColorStop(1, '#d4ff00')
      ctx.strokeStyle = stroke
      ctx.lineWidth = mode === 'pill' ? 1.6 : 2.2
      ctx.stroke()

      // Center baseline
      ctx.beginPath()
      ctx.moveTo(0, midY)
      ctx.lineTo(width, midY)
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      ctx.stroke()

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [audioEl, active, mode])

  return (
    <canvas
      ref={canvasRef}
      className={`rw-real-wave rw-real-wave--${mode} ${className}`.trim()}
      aria-hidden
    />
  )
}
