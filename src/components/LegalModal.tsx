import { AnimatePresence, motion } from 'framer-motion'
import { LEGAL, type LegalDoc } from '../lib/legal'

type Props = {
  doc: LegalDoc | null
  onClose: () => void
}

export function LegalModal({ doc, onClose }: Props) {
  const legal = doc ? LEGAL[doc] : null

  return (
    <AnimatePresence>
      {legal && doc && (
        <motion.div
          className="rw-modal-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            className="rw-modal-backdrop"
            aria-label="Close"
            onClick={onClose}
          />
          <motion.div
            className="rw-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-title"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <div className="rw-modal-head">
              <div>
                <p className="rw-label">legal</p>
                <h2 id="legal-title">{legal.title}</h2>
                <p className="rw-modal-updated">Updated {legal.updated}</p>
              </div>
              <button
                type="button"
                className="rw-modal-close"
                onClick={onClose}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>
            <div className="rw-modal-body">
              {legal.body.map((para) => (
                <p key={para.slice(0, 24)}>{para}</p>
              ))}
            </div>
            <button type="button" className="rw-cta" onClick={onClose}>
              GOT IT
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
