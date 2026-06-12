const RING_STYLE: React.CSSProperties = {
  fill: 'none',
  transformBox: 'fill-box',
  transformOrigin: 'center',
}

const PARTICLES = [
  { size: 6, x: 50, y: 28, delay: 0,   dur: 2.4 },
  { size: 4, x: 68, y: 36, delay: 0.5, dur: 2.8 },
  { size: 5, x: 32, y: 38, delay: 1.1, dur: 2.2 },
  { size: 3, x: 62, y: 22, delay: 1.7, dur: 3.0 },
  { size: 4, x: 40, y: 24, delay: 0.9, dur: 2.6 },
]

export function LoadingScreen() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: 'var(--bg)',
      }}
    >
      {/* Ambient glow */}
      <div
        style={{
          position: 'absolute',
          width: 480,
          height: 480,
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--accent-glow) 0%, transparent 68%)',
          animation: 'load-glow-pulse 3.2s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />

      {/* Spinner */}
      <div style={{ position: 'relative', width: 112, height: 112 }}>
        <svg
          width="112"
          height="112"
          viewBox="0 0 100 100"
          style={{ position: 'absolute', inset: 0 }}
        >
          {/* outer ring — 3 arcs, CW, slowest */}
          <circle
            cx="50" cy="50" r="42"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="43.98 43.98"
            style={{
              ...RING_STYLE,
              stroke: 'var(--accent)',
              opacity: 0.75,
              animation: 'spin-cw 5s linear infinite',
            }}
          />
          {/* mid ring — 2 arcs, CCW */}
          <circle
            cx="50" cy="50" r="32"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="50.27 50.27"
            style={{
              ...RING_STYLE,
              stroke: 'var(--accent)',
              opacity: 0.5,
              animation: 'spin-ccw 3.2s linear infinite',
            }}
          />
          {/* inner ring — sweeping arc, CW, fastest */}
          <circle
            cx="50" cy="50" r="21"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="98.96 32.99"
            style={{
              ...RING_STYLE,
              stroke: 'var(--accent)',
              opacity: 0.4,
              animation: 'spin-cw 1.8s linear infinite',
            }}
          />
        </svg>

        {/* Center "d" */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'load-pulse 2.6s ease-in-out infinite',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-sans, sans-serif)',
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              color: 'var(--accent)',
              userSelect: 'none',
              lineHeight: 1,
            }}
          >
            d
          </span>
        </div>

        {/* Mist particles */}
        {PARTICLES.map((p, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              borderRadius: '50%',
              background: 'var(--accent)',
              filter: 'blur(2px)',
              opacity: 0,
              animation: `mist-rise ${p.dur}s ease-out ${p.delay}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Wordmark — visible immediately, no fade delay */}
      <div style={{ marginTop: 28 }}>
        <span
          style={{
            fontFamily: 'var(--font-sans, sans-serif)',
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: '0.02em',
            color: 'var(--fg-muted)',
            userSelect: 'none',
          }}
        >
          <span style={{ color: 'var(--accent)' }}>de</span>mist
        </span>
      </div>

      {/* Tagline — visible immediately */}
      <div style={{ marginTop: 6 }}>
        <span
          style={{
            fontFamily: 'var(--font-sans, sans-serif)',
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--fg-faint)',
            userSelect: 'none',
          }}
        >
          clearing the fog
        </span>
      </div>
    </div>
  )
}
