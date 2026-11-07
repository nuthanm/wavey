import { useEffect, useRef } from 'react'

/** Soft full-page background waves that follow the cursor. */
export function CursorWaves() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pointer = useRef({ x: 0.5, y: 0.5, active: false })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const start = performance.now()
    const N = 90
    const left = new Float32Array(N)
    const right = new Float32Array(N)

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const { width, height } = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const onMove = (e: PointerEvent) => {
      pointer.current.x = e.clientX / window.innerWidth
      pointer.current.y = e.clientY / window.innerHeight
      pointer.current.active = true
    }
    const onLeave = () => {
      pointer.current.active = false
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave)

    const curve = (
      values: Float32Array,
      midY: number,
      amp: number,
      width: number,
      invert: boolean,
    ) => {
      const step = width / (N - 1)
      ctx.beginPath()
      for (let i = 0; i < N; i++) {
        const x = i * step
        const y = midY + (invert ? 1 : -1) * values[i] * amp
        if (i === 0) ctx.moveTo(x, y)
        else {
          const x0 = (i - 1) * step
          const y0 = midY + (invert ? 1 : -1) * values[i - 1] * amp
          const cpx = (x0 + x) / 2
          ctx.quadraticCurveTo(x0, y0, cpx, (y0 + y) / 2)
          if (i === N - 1) ctx.lineTo(x, y)
        }
      }
    }

    const draw = (now: number) => {
      const t = (now - start) / 1000
      const { width, height } = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, width, height)

      const { x: px, y: py, active } = pointer.current
      const energy = active ? 1 : 0.35
      const focusX = px
      const boost = 0.55 + (1 - py) * 0.85

      for (let i = 0; i < N; i++) {
        const x = i / (N - 1)
        const dist = Math.abs(x - focusX)
        const proximity = Math.exp(-(dist * dist) * (active ? 14 : 4))
        const base =
          Math.sin(t * (1.6 + energy) + x * 8) * 0.35 +
          Math.sin(t * (2.8 + energy * 1.4) + x * 15) * 0.2
        const target = (base * 0.45 + proximity * boost * 0.7) * energy
        left[i] += (target - left[i]) * 0.16
        right[i] += (target * 0.82 - right[i]) * 0.14
      }

      const mid = height * (0.42 + py * 0.2)
      const amp = height * 0.12 * (0.7 + energy * 0.5)

      curve(left, mid, amp, width, false)
      ctx.strokeStyle = `rgba(212,255,0,${0.08 + energy * 0.12})`
      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      ctx.stroke()

      curve(right, mid, amp * 0.75, width, true)
      ctx.strokeStyle = `rgba(92,225,255,${0.06 + energy * 0.1})`
      ctx.lineWidth = 1.2
      ctx.stroke()

      // Cursor ripple
      if (active) {
        const cx = px * width
        const cy = py * height
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 140)
        g.addColorStop(0, 'rgba(212,255,0,0.07)')
        g.addColorStop(0.5, 'rgba(92,225,255,0.04)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(cx - 140, cy - 140, 280, 280)
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return <canvas ref={canvasRef} className="rw-cursor-waves" aria-hidden />
}
