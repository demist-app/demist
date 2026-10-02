import Image from 'next/image'

// The Demist waveform, recoloured for the Graceful Minds partnership (2026-10-02):
// plum outer bars, periwinkle, teal centre, matching the infinity loop in their logo.
// Dark mode lifts each bar to its pastel so it does not sink into the plum-black page.
const BARS = [
  { x: 7,  y1: 14, y2: 18, w: 2.5, light: '#5B3F8F', dark: '#B9A6E6' },
  { x: 11, y1: 11, y2: 21, w: 2.5, light: '#556EAE', dark: '#9FB3E6' },
  { x: 16, y1: 8,  y2: 24, w: 3,   light: '#2A777A', dark: '#7CC9C0' },
  { x: 21, y1: 11, y2: 21, w: 2.5, light: '#556EAE', dark: '#9FB3E6' },
  { x: 25, y1: 14, y2: 18, w: 2.5, light: '#5B3F8F', dark: '#B9A6E6' },
]

export function DemistWaveform({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="4 6 24 20" aria-hidden className={className}>
      {BARS.map(b => (
        <line
          key={b.x}
          x1={b.x} y1={b.y1} x2={b.x} y2={b.y2}
          strokeWidth={b.w} strokeLinecap="round"
          className="[stroke:var(--l)] dark:[stroke:var(--d)]"
          style={{ ['--l' as string]: b.light, ['--d' as string]: b.dark }}
        />
      ))}
    </svg>
  )
}

/** Demist wordmark with the Graceful Minds endorsement underneath. */
export function BrandMark({ endorsed = true, size = 'md' }: { endorsed?: boolean; size?: 'md' | 'lg' }) {
  const lg = size === 'lg'
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <DemistWaveform size={lg ? 30 : 22} />
      <span className="flex flex-col leading-none">
        <span className={`${lg ? 'text-[19px]' : 'text-[15px]'} font-semibold tracking-tight`} style={{ color: 'var(--fg)' }}>
          Demist
        </span>
        {endorsed && (
          <span className={`${lg ? 'text-[11px]' : 'text-[10px]'} font-medium mt-[3px]`} style={{ color: 'var(--fg-muted)' }}>
            by Graceful Minds
          </span>
        )}
      </span>
    </span>
  )
}

/** The Graceful Minds butterfly-infinity mark. Works on light and dark. */
export function GracefulMindsMark({ height = 28, className = '' }: { height?: number; className?: string }) {
  // Width pinned to the same integer as the attribute: with width:auto the
  // browser lays out a fractional width (115.66px at height 72) whose integer
  // differs from the attribute, and Next warns about a distorted image.
  const width = Math.round(height * (461 / 287))
  return (
    <Image
      src="/graceful-minds-mark.png"
      alt="Graceful Minds"
      width={width}
      height={height}
      className={className}
      style={{ height, width }}
    />
  )
}
