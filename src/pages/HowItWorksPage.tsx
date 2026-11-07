import { Link } from 'react-router-dom'
import { HowItWorks } from '../components/HowItWorks'

export function HowItWorksPage() {
  return (
    <div className="rw-page">
      <header className="rw-page-bar">
        <Link className="rw-logo" to="/" aria-label="Wavey home">
          <span className="rw-logo-mark">WY</span>
          <span className="rw-logo-text">Wavey</span>
        </Link>
        <Link className="rw-nav-link" to="/">
          ← Back to app
        </Link>
      </header>
      <HowItWorks />
    </div>
  )
}
