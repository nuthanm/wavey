from pathlib import Path
import re

p = Path('src/pages/HomePage.tsx')
text = p.read_text(encoding='utf-8')

text = text.replace("from './lib/demoAudio'", "from '../lib/demoAudio'")
text = text.replace(
    "import { FlowWave } from './components/FlowWave'\nimport { HowItWorks } from './components/HowItWorks'\n\n",
    "import { Link } from 'react-router-dom'\n\n",
)
text = text.replace("type LegalDoc = 'privacy' | 'terms' | null\n\n", '')

start = text.find('const LEGAL = {')
end = text.find('function formatTime')
if start != -1 and end != -1:
    text = text[:start] + text[end:]

text = text.replace('export default function App()', 'export function HomePage()')
text = text.replace("  const [legalDoc, setLegalDoc] = useState<LegalDoc>(null)\n\n", '\n')
text = re.sub(
    r"\n  useEffect\(\(\) => \{\n    if \(!legalDoc\) return\n.*?\}, \[legalDoc\]\)\n",
    '\n',
    text,
    flags=re.S,
)
text = text.replace('  const legal = legalDoc ? LEGAL[legalDoc] : null\n\n', '')

text = text.replace(
    '''  return (
    <div className="rw-app">
      <div className="rw-glow" aria-hidden />
      <div className="rw-noise" aria-hidden />

      <div className="rw-shell">''',
    '''  return (
    <>
      <div className="rw-shell">''',
)

text = text.replace(
    '''              <div className="rw-top-actions">
                <a className="rw-nav-link" href="#how-it-works">
                  How it works
                </a>
                <span className="rw-pill">prototype live</span>
              </div>''',
    '''              <div className="rw-top-actions">
                <Link className="rw-nav-link" to="/how-it-works">
                  How it works
                </Link>
                <span className="rw-pill">prototype live</span>
              </div>''',
)

idx = text.find('      <HowItWorks />')
if idx == -1:
    raise SystemExit('HowItWorks marker missing')

before = text[:idx]
rest = text[idx:]
toast_idx = rest.find('      <AnimatePresence>\n        {toast &&')
if toast_idx == -1:
    raise SystemExit('toast marker missing')

toast_rest = rest[toast_idx:]
end_toast = toast_rest.find('      </AnimatePresence>')
if end_toast == -1:
    raise SystemExit('toast end missing')
toast = toast_rest[: end_toast + len('      </AnimatePresence>')]

text = before + toast + '\n    </>\n  )\n}\n'
p.write_text(text, encoding='utf-8')
print('HomePage fixed', p.stat().st_size)
