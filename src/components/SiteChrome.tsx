import type { LegalDoc } from '../lib/legal'
import { MorphWave } from './MorphWave'

type Props = {
  onOpenLegal: (doc: LegalDoc) => void
}

export function SiteChrome({ onOpenLegal }: Props) {
  return (
    <div className="rw-chrome">
      <div className="rw-chrome-wave" aria-hidden>
        <MorphWave />
      </div>
      <footer className="rw-legal-bar">
        <button type="button" onClick={() => onOpenLegal('privacy')}>
          Privacy Policy
        </button>
        <span aria-hidden>·</span>
        <button type="button" onClick={() => onOpenLegal('terms')}>
          Terms & Conditions
        </button>
      </footer>
    </div>
  )
}
