const STEPS = [
  {
    id: '01',
    title: 'Paste the link',
    copy: 'Drop a YouTube or Instagram URL. Wavey auto-detects the source.',
    shot: 'paste' as const,
  },
  {
    id: '02',
    title: 'Pick your format',
    copy: 'MP3 loudness tiers or MP4 resolution. Instagram saves the file as Instagram hosted it.',
    shot: 'format' as const,
  },
  {
    id: '03',
    title: 'Pull it',
    copy: 'One tap. Wavey resolves the stream, downloads it, and encodes MP3 in your browser when needed.',
    shot: 'rip' as const,
  },
  {
    id: '04',
    title: 'Play anywhere',
    copy: 'Preview in-app, then download HQ and share to phone, desktop, or webview.',
    shot: 'play' as const,
  },
]

function ShotPaste() {
  return (
    <div className="rw-shot-ui">
      <div className="rw-shot-tabs">
        <span className="on">YouTube</span>
        <span>Instagram</span>
      </div>
      <div className="rw-shot-field">
        <i />
        youtube.com/watch?v=…
      </div>
      <div className="rw-shot-hint ok">source locked · looking good</div>
    </div>
  )
}

function ShotFormat() {
  return (
    <div className="rw-shot-ui">
      <div className="rw-shot-seg">
        <span className="on">
          <b>MP3</b>
          <small>audio only</small>
        </span>
        <span>
          <b>MP4</b>
          <small>full video</small>
        </span>
      </div>
      <div className="rw-shot-quals">
        <span>128</span>
        <span>192</span>
        <span className="on">320</span>
        <span>Studio</span>
      </div>
    </div>
  )
}

function ShotRip() {
  return (
    <div className="rw-shot-ui">
      <div className="rw-shot-cta">PULL TO MP3 ↗</div>
      <div className="rw-shot-progress">
        <div>
          <span>encoding 320kbps…</span>
          <strong>81%</strong>
        </div>
        <i>
          <b style={{ width: '81%' }} />
        </i>
      </div>
      <div className="rw-shot-wave-line" aria-hidden>
        <svg viewBox="0 0 200 36" preserveAspectRatio="none">
          <path
            d="M0 18 C 12 8, 24 28, 36 18 S 60 6, 72 18 96 30, 108 18 132 8, 144 18 168 28, 180 18 192 10, 200 18"
            fill="none"
            stroke="#d4ff00"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M0 18 C 12 8, 24 28, 36 18 S 60 6, 72 18 96 30, 108 18 132 8, 144 18 168 28, 180 18 192 10, 200 18"
            fill="rgba(212,255,0,0.12)"
            stroke="none"
          />
        </svg>
      </div>
    </div>
  )
}

function ShotPlay() {
  return (
    <div className="rw-shot-ui">
      <div className="rw-shot-meta">
        <div className="rw-shot-thumb" />
        <div>
          <strong>midnight drive // unreleased</strong>
          <small>@vibekitchen · Cranked · 320kbps</small>
        </div>
      </div>
      <div className="rw-shot-player">
        <button type="button" tabIndex={-1}>
          ▶
        </button>
        <i />
        <span>0:42</span>
      </div>
      <div className="rw-shot-dl">Download MP3</div>
    </div>
  )
}

function Screenshot({ shot }: { shot: (typeof STEPS)[number]['shot'] }) {
  return (
    <div className="rw-shot">
      <div className="rw-shot-chrome">
        <span />
        <span />
        <span />
        <em>wavey.app</em>
      </div>
      <div className="rw-shot-body">
        {shot === 'paste' && <ShotPaste />}
        {shot === 'format' && <ShotFormat />}
        {shot === 'rip' && <ShotRip />}
        {shot === 'play' && <ShotPlay />}
      </div>
    </div>
  )
}

export function HowItWorks() {
  return (
    <section className="rw-how" id="how-it-works" aria-labelledby="how-title">
      <div className="rw-how-inner">
        <header className="rw-how-head">
          <p className="rw-label">guide</p>
          <h2 id="how-title">
            how it works
            <span> in 4 pulls</span>
          </h2>
          <p>
            From paste to playback — real resolve, stream, and encode behind the
            same screens.
          </p>
        </header>

        <ol className="rw-timeline">
          {STEPS.map((step, index) => (
            <li key={step.id} className="rw-timeline-item">
              <div className="rw-timeline-rail" aria-hidden>
                <span className="rw-timeline-dot">{step.id}</span>
                {index < STEPS.length - 1 && <span className="rw-timeline-line" />}
              </div>

              <div className="rw-timeline-content">
                <div className="rw-timeline-copy">
                  <h3>{step.title}</h3>
                  <p>{step.copy}</p>
                </div>
                <Screenshot shot={step.shot} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
