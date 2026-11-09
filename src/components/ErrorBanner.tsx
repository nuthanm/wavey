import { motion } from 'framer-motion'
import type { FriendlyError } from '../lib/errors'

type Props = {
  error: FriendlyError
  onDismiss?: () => void
  /** Optional recovery action the UI can offer (e.g. switch to Upload). */
  actionLabel?: string
  onAction?: () => void
}

export function ErrorBanner({ error, onDismiss, actionLabel, onAction }: Props) {
  return (
    <motion.div
      className="rw-error-banner"
      role="alert"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
    >
      <div className="rw-error-banner-top">
        <strong>{error.title}</strong>
        {onDismiss && (
          <button type="button" className="rw-error-dismiss" onClick={onDismiss} aria-label="Dismiss">
            ✕
          </button>
        )}
      </div>
      <p>{error.message}</p>
      {error.hint && <p className="rw-error-hint">{error.hint}</p>}
      {actionLabel && onAction && (
        <button type="button" className="rw-error-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </motion.div>
  )
}
