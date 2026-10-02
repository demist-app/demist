import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#130d1f',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
        }}
      >
        {/* amber ambient glow */}
        <div
          style={{
            position: 'absolute',
            width: 900,
            height: 900,
            borderRadius: 450,
            background: 'rgba(200,130,20,0.10)',
            filter: 'blur(130px)',
            display: 'flex',
          }}
        />

        {/* waveform icon */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
          {[
            { h: 20, color: '#9a82cf' },
            { h: 36, color: '#8fa5dc' },
            { h: 52, color: '#7cc9c0' },
            { h: 36, color: '#8fa5dc' },
            { h: 20, color: '#9a82cf' },
          ].map((bar, i) => (
            <div
              key={i}
              style={{
                width: 9,
                height: bar.h,
                borderRadius: 6,
                background: bar.color,
                display: 'flex',
              }}
            />
          ))}
        </div>

        <p
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.22em',
            color: 'rgba(195,178,234,0.85)',
            textTransform: 'uppercase',
            margin: 0,
            display: 'flex',
          }}
        >
          DEMIST
        </p>

        <h1
          style={{
            fontSize: 66,
            fontWeight: 800,
            color: '#f6f4fa',
            textAlign: 'center',
            lineHeight: 1.08,
            margin: 0,
            maxWidth: 860,
            display: 'flex',
          }}
        >
          Never feel lost in a lecture again.
        </h1>

        <p
          style={{
            fontSize: 22,
            color: 'rgba(130,120,100,1)',
            textAlign: 'center',
            margin: 0,
            display: 'flex',
          }}
        >
          Real-time definitions for university students.
        </p>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
