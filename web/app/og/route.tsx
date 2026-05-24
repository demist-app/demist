import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#080810',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
        }}
      >
        {/* background glow */}
        <div
          style={{
            position: 'absolute',
            width: 900,
            height: 900,
            borderRadius: 450,
            background: 'rgba(139,92,246,0.09)',
            filter: 'blur(130px)',
            display: 'flex',
          }}
        />

        <p
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.22em',
            color: 'rgba(167,139,250,0.6)',
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
            color: '#ffffff',
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
            color: 'rgba(107,114,128,1)',
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
