import { motion } from 'framer-motion'

export type LinkPreviewData = {
  platform: 'youtube' | 'instagram' | 'unknown'
  title: string
  creator: string
  duration: string
  url: string
  thumbHue: number
  thumbUrl: string | null
  kindLabel: string
}

type Props = {
  data: LinkPreviewData
}

function shortenUrl(url: string) {
  try {
    const u = new URL(url)
    const path = `${u.pathname}${u.search}`.replace(/\/$/, '')
    const clipped = path.length > 42 ? `${path.slice(0, 42)}…` : path
    return `${u.hostname.replace('www.', '')}${clipped}`
  } catch {
    return url.slice(0, 48)
  }
}

export function LinkPreview({ data }: Props) {
  return (
    <motion.div
      className="rw-link-preview"
      initial={{ opacity: 0, y: 8, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
    >
      <div
        className={`rw-link-thumb ${data.platform}`}
        style={{ ['--hue' as string]: data.thumbHue }}
      >
        {data.thumbUrl ? (
          <img src={data.thumbUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="rw-link-thumb-fallback" aria-hidden>
            <span>{data.platform === 'instagram' ? 'IG' : '▶'}</span>
          </div>
        )}
        {data.platform !== 'unknown' && (
          <em className="rw-link-badge">{data.kindLabel}</em>
        )}
      </div>

      <div className="rw-link-copy">
        <p className="rw-link-kicker">copied preview</p>
        <h3>{data.title}</h3>
        <p className="rw-link-meta">
          {data.creator} · {data.duration}
        </p>
        <p className="rw-link-url" title={data.url}>
          {shortenUrl(data.url)}
        </p>
      </div>
    </motion.div>
  )
}
