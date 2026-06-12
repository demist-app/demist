// SVG circumferences:
//  outer r=42 → C≈263.9   3 arcs: dasharray="43.98 43.98" (equal arc/gap, 60°/60° each, 3 cycles)
//  mid   r=32 → C≈201.1   2 arcs: dasharray="50.27 50.27" (90°/90° each, 2 cycles)
//  inner r=21 → C≈131.9   1 sweeping arc of ~270°: dasharray="98.96 32.99"

export function LoadingScreen() {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      {/* ── Ambient background glow ── */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 480,
          height: 480,
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--accent-glow) 0%, transparent 68%)',
          animation: 'load-glow-pulse 3.2s ease-in-out infinite',
        }}
      />

      {/* ── Spinner + center ── */}
      <div className="relative" style={{ width: 112, height: 112 }}>
        <svg
          width="112"
          height="112"
          viewBox="0 0 100 100"
          fill="none"
          style={{ position: 'absolute', inset: 0 }}
        >
          {/* outer ring — 3 arcs, clockwise, slowest */}
          <circle
            cx="50" cy="50" r="42"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="43.98 43.98"
            style={{
              transformOrigin: '50px 50px',
              animation: 'spin-cw 5s linear infinite',
              opacity: 0.75,
            }}
          />
          {/* mid ring — 2 arcs, counter-clockwise */}
          <circle
            cx="50" cy="50" r="32"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="50.27 50.27"
            style={{
              transformOrigin: '50px 50px',
              animation: 'spin-ccw 3.2s linear infinite',
              opacity: 0.5,
            }}
          />
          {/* inner ring — single sweeping arc, clockwise, fastest */}
          <circle
            cx="50" cy="50" r="21"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="98.96 32.99"
            style={{
              transformOrigin: '50px 50px',
              animation: 'spin-cw 1.8s linear infinite',
              opacity: 0.4,
            }}
          />
        </svg>

        {/* center "D" glyph */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ animation: 'load-pulse 2.6s ease-in-out infinite' }}
        >
          <span
            style={{
              fontFamily: 'var(--font-sans)',
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

        {/* mist particles */}
        {[
          { size: 6,  x: 50,  y: 28,  delay: 0,    dur: 2.4 },
          { size: 4,  x: 68,  y: 36,  delay: 0.5,  dur: 2.8 },
          { size: 5,  x: 32,  y: 38,  delay: 1.1,  dur: 2.2 },
          { size: 3,  x: 62,  y: 22,  delay: 1.7,  dur: 3.0 },
          { size: 4,  x: 40,  y: 24,  delay: 0.9,  dur: 2.6 },
        ].map((p, i) => (
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
              animation: `mist-rise ${p.dur}s ease-out ${p.delay}s infinite`,
              opacity: 0,
            }}
          />
        ))}
      </div>

      {/* ── Wordmark ── */}
      <div
        style={{
          marginTop: 28,
          animation: 'load-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.1s both',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-sans)',
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

      {/* ── Tagline ── */}
      <div
        style={{
          marginTop: 6,
          animation: 'load-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.22s both',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-sans)',
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
