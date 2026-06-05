import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#0f0e0b',
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
            { h: 20, color: '#b36a00' },
            { h: 36, color: '#c97d10' },
            { h: 52, color: '#f5a623' },
            { h: 36, color: '#c97d10' },
            { h: 20, color: '#b36a00' },
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
            color: 'rgba(245,166,35,0.75)',
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
            color: '#f5f3ef',
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
