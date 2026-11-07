import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { CursorWaves } from './components/CursorWaves'
import { LegalModal } from './components/LegalModal'
import { SiteChrome } from './components/SiteChrome'
import type { LegalDoc } from './lib/legal'
import { HomePage } from './pages/HomePage'
import { HowItWorksPage } from './pages/HowItWorksPage'

function AppLayout() {
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null)

  useEffect(() => {
    if (!legalDoc) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLegalDoc(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [legalDoc])

  return (
    <div className="rw-app">
      <div className="rw-glow" aria-hidden />
      <div className="rw-noise" aria-hidden />
      <CursorWaves />
      <Outlet />
      <SiteChrome onOpenLegal={setLegalDoc} />
      <LegalModal doc={legalDoc} onClose={() => setLegalDoc(null)} />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
