import { useEffect, useRef } from 'react'

type Props = {
  className?: string
}

/**
 * Backend conversion pipeline visual.
 * No vertical bars — film frames for video, animated waves on stage hops.
 */
export function MorphWave({ className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pointer = useRef({ x: 0.5, y: 0.5, inside: false })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const start = performance.now()

    const stages = [
      { key: 'in', label: 'VIDEO', sub: 'mp4 / webm', kind: 'film' },
      { key: 'demux', label: 'DEMUX', sub: 'split tracks', kind: 'film' },
      { key: 'decode', label: 'DECODE', sub: 'aac → pcm', kind: 'wave' },
      { key: 'encode', label: 'ENCODE', sub: 'pcm → mp3', kind: 'wave' },
      { key: 'out', label: 'AUDIO', sub: 'mp3 / wav', kind: 'wave' },
    ] as const

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
      const rect = canvas.getBoundingClientRect()
      pointer.current.x = (e.clientX - rect.left) / Math.max(1, rect.width)
      pointer.current.y = (e.clientY - rect.top) / Math.max(1, rect.height)
      pointer.current.inside = true
    }
    const onEnter = () => {
      pointer.current.inside = true
    }
    const onLeave = () => {
      pointer.current.inside = false
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerenter', onEnter)
    canvas.addEventListener('pointerleave', onLeave)

    const roundRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      r: number,
    ) => {
      const radius = Math.min(r, w / 2, h / 2)
      ctx.beginPath()
      ctx.moveTo(x + radius, y)
      ctx.arcTo(x + w, y, x + w, y + h, radius)
      ctx.arcTo(x + w, y + h, x, y + h, radius)
      ctx.arcTo(x, y + h, x, y, radius)
      ctx.arcTo(x, y, x + w, y, radius)
      ctx.closePath()
    }

    /** Horizontal film strip — not vertical bars */
    const drawFilm = (
      x: number,
      y: number,
      w: number,
      h: number,
      t: number,
      speed: number,
    ) => {
      const frames = 3
      const gap = 3
      const fw = (w - gap * (frames - 1)) / frames
      const scroll = ((t * speed * 12) % (fw + gap)) - (fw + gap)

      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, w, h)
      ctx.clip()

      for (let i = -1; i < frames + 1; i++) {
        const fx = x + scroll + i * (fw + gap)
        const hue = 28 + ((i + 3) % 5) * 14
        const g = ctx.createLinearGradient(fx, y, fx + fw, y + h)
        g.addColorStop(0, `hsl(${hue} 80% 48%)`)
        g.addColorStop(1, `hsl(${hue + 30} 70% 38%)`)
        roundRect(fx, y, fw, h, 4)
        ctx.fillStyle = g
        ctx.fill()

        // Film perforations
        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.fillRect(fx + 2, y + 2, 2, 2)
        ctx.fillRect(fx + fw - 4, y + 2, 2, 2)
        ctx.fillRect(fx + 2, y + h - 4, 2, 2)
        ctx.fillRect(fx + fw - 4, y + h - 4, 2, 2)

        // Play triangle
        ctx.fillStyle = 'rgba(0,0,0,0.4)'
        ctx.beginPath()
        ctx.moveTo(fx + fw * 0.38, y + h * 0.3)
        ctx.lineTo(fx + fw * 0.38, y + h * 0.7)
        ctx.lineTo(fx + fw * 0.68, y + h * 0.5)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
    }

    const drawWave = (
      x: number,
      y: number,
      w: number,
      h: number,
      t: number,
      color: string,
      strength: number,
      cursorX: number,
      freqBoost: number,
    ) => {
      const mid = y + h / 2
      const n = 36
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1)
        const px = x + u * w
        const near = Math.exp(-Math.pow(u - cursorX, 2) * 16)
        const amp =
          (Math.sin(t * (4.5 + freqBoost) + i * 0.5) * 0.42 +
            Math.sin(t * (7.2 + freqBoost) + i * 0.85) * 0.28 +
            Math.sin(t * 2.1 + i * 0.2) * 0.12) *
          (0.5 + near * 0.85)
        const py = mid - amp * (h * 0.42) * strength
        if (i === 0) ctx.moveTo(px, py)
        else {
          const prevU = (i - 1) / (n - 1)
          const x0 = x + prevU * w
          const y0 =
            mid -
            (Math.sin(t * (4.5 + freqBoost) + (i - 1) * 0.5) * 0.42 +
              Math.sin(t * (7.2 + freqBoost) + (i - 1) * 0.85) * 0.28) *
              (0.5 + Math.exp(-Math.pow(prevU - cursorX, 2) * 16) * 0.85) *
              (h * 0.42) *
              strength
          const cpx = (x0 + px) / 2
          ctx.quadraticCurveTo(x0, y0, cpx, (y0 + py) / 2)
          if (i === n - 1) ctx.lineTo(px, py)
        }
      }
      ctx.strokeStyle = color
      ctx.lineWidth = 1.7
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke()

      // Soft mirror
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1)
        const px = x + u * w
        const amp =
          Math.sin(t * (4.5 + freqBoost) + i * 0.5) * 0.35 +
          Math.sin(t * (7.2 + freqBoost) + i * 0.85) * 0.2
        const py = mid + amp * (h * 0.28) * strength
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.strokeStyle = color.replace(')', ', 0.45)').replace('rgb', 'rgba').replace('#d4ff00', 'rgba(212,255,0,0.45)').replace('#5ce1ff', 'rgba(92,225,255,0.45)')
      if (color.startsWith('#')) {
        ctx.strokeStyle = color === '#d4ff00' ? 'rgba(212,255,0,0.4)' : 'rgba(92,225,255,0.4)'
      }
      ctx.lineWidth = 1.1
      ctx.stroke()
    }

    /** Animated traveling wave on the connector between stages */
    const drawLinkWave = (
      x1: number,
      x2: number,
      y: number,
      t: number,
      active: boolean,
      traveling: boolean,
      intensity: number,
    ) => {
      const n = 28
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1)
        const x = x1 + (x2 - x1) * u
        const envelope = traveling
          ? Math.exp(-Math.pow(u - ((t * 1.8) % 1.4) + 0.2, 2) * 18)
          : 0.35
        const amp =
          Math.sin(t * 9 + u * 16) * 5.5 * intensity * (active ? 1 : 0.25) * (0.35 + envelope)
        const py = y + amp
        if (i === 0) ctx.moveTo(x, py)
        else ctx.lineTo(x, py)
      }
      ctx.strokeStyle = traveling
        ? 'rgba(212,255,0,0.9)'
        : active
          ? 'rgba(212,255,0,0.45)'
          : 'rgba(255,255,255,0.12)'
      ctx.lineWidth = traveling ? 2.2 : 1.6
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.shadowColor = traveling ? 'rgba(212,255,0,0.55)' : 'transparent'
      ctx.shadowBlur = traveling ? 8 : 0
      ctx.stroke()
      ctx.shadowBlur = 0

      // Twin lower ripple when hopping
      if (traveling || active) {
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1)
          const x = x1 + (x2 - x1) * u
          const envelope = traveling
            ? Math.exp(-Math.pow(u - ((t * 1.8) % 1.4) + 0.2, 2) * 18)
            : 0.25
          const amp =
            Math.sin(t * 9 + u * 16 + 1.2) *
            3.5 *
            intensity *
            (0.3 + envelope)
          const py = y - amp
          if (i === 0) ctx.moveTo(x, py)
          else ctx.lineTo(x, py)
        }
        ctx.strokeStyle = 'rgba(92,225,255,0.55)'
        ctx.lineWidth = 1.2
        ctx.stroke()
      }
    }

    const draw = (now: number) => {
      const t = (now - start) / 1000
      const { width, height } = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, width, height)

      const { x: cx, y: cy, inside } = pointer.current
      const hover = inside ? 1 : 0
      const speed = 0.14 + hover * (0.1 + (1 - cy) * 0.22)
      const waveBoost = 0.85 + hover * (0.45 + (1 - cy) * 0.7)
      const freqBoost = hover * (1.2 + (1 - cy) * 1.5)

      const padX = Math.max(12, width * 0.03)
      const usable = width - padX * 2
      const boxW = Math.min(118, usable / 6.2)
      const boxH = Math.min(58, height * 0.62)
      const boxY = (height - boxH) / 2 - 2
      const gap =
        (usable - boxW * stages.length) / Math.max(1, stages.length - 1)

      const autoU = (t * speed) % 1
      const packetU = inside ? cx * 0.85 + autoU * 0.15 : autoU
      const activeIndex = Math.min(
        stages.length - 1,
        Math.floor(packetU * stages.length),
      )
      const hopIndex = Math.min(
        stages.length - 2,
        Math.floor(packetU * (stages.length - 1)),
      )

      const centers: number[] = []
      stages.forEach((stage, i) => {
        const x = padX + i * (boxW + gap)
        centers.push(x + boxW / 2)

        const lit = i <= activeIndex
        const hot = i === activeIndex

        roundRect(x, boxY, boxW, boxH, 12)
        ctx.fillStyle = hot
          ? 'rgba(212,255,0,0.12)'
          : lit
            ? 'rgba(255,255,255,0.04)'
            : 'rgba(255,255,255,0.025)'
        ctx.fill()
        ctx.strokeStyle = hot
          ? 'rgba(212,255,0,0.65)'
          : lit
            ? 'rgba(92,225,255,0.35)'
            : 'rgba(255,255,255,0.08)'
        ctx.lineWidth = hot ? 1.5 : 1
        ctx.stroke()

        const contentX = x + 8
        const contentY = boxY + 8
        const contentW = boxW - 16
        const contentH = 18

        if (stage.kind === 'film') {
          drawFilm(contentX, contentY, contentW, contentH, t, speed * 8)
        } else {
          drawWave(
            contentX,
            contentY,
            contentW,
            contentH,
            t,
            stage.key === 'out' ? '#d4ff00' : '#5ce1ff',
            (lit ? 1 : 0.4) * waveBoost,
            cx,
            freqBoost,
          )
        }

        ctx.textAlign = 'center'
        ctx.font = '800 11px Syne, system-ui, sans-serif'
        ctx.fillStyle = hot ? '#d4ff00' : lit ? '#f4f4f2' : '#6f6f6a'
        ctx.fillText(stage.label, x + boxW / 2, boxY + boxH - 16)
        ctx.font = '600 9px Space Grotesk, system-ui, sans-serif'
        ctx.fillStyle = hot ? 'rgba(212,255,0,0.75)' : '#7a7a74'
        ctx.fillText(stage.sub, x + boxW / 2, boxY + boxH - 5)
      })

      // Wave connectors between stages
      for (let i = 0; i < centers.length - 1; i++) {
        const x1 = centers[i] + boxW / 2 - 2
        const x2 = centers[i + 1] - boxW / 2 + 2
        const y = boxY + boxH / 2
        const traveling = i === hopIndex
        const active = i < activeIndex || traveling
        drawLinkWave(
          x1,
          x2,
          y,
          t + i,
          active,
          traveling,
          waveBoost * (traveling ? 1.35 : 0.8),
        )
      }

      // Packet
      const seg = packetU * (stages.length - 1)
      const segIndex = Math.min(stages.length - 2, Math.floor(seg))
      const segT = seg - segIndex
      const px =
        centers[segIndex] +
        (centers[segIndex + 1] - centers[segIndex]) * segT
      const py = boxY + boxH / 2

      // Local ripple around packet
      ctx.beginPath()
      ctx.arc(px, py, 10 + Math.sin(t * 8) * 2, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(212,255,0,0.25)'
      ctx.lineWidth = 1
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(px, py, inside ? 6 : 5, 0, Math.PI * 2)
      ctx.fillStyle = '#d4ff00'
      ctx.shadowColor = 'rgba(212,255,0,0.75)'
      ctx.shadowBlur = inside ? 14 : 10
      ctx.fill()
      ctx.shadowBlur = 0

      if (activeIndex >= 1) {
        ctx.font = '600 9px Space Grotesk, system-ui, sans-serif'
        ctx.fillStyle = 'rgba(255,77,109,0.7)'
        ctx.textAlign = 'center'
        ctx.fillText('video track discarded', centers[1], boxY - 6)
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerenter', onEnter)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={`rw-morph-wave ${className}`.trim()}
      aria-hidden
    />
  )
}
