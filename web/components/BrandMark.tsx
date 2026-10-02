import Image from 'next/image'

// The Demist waveform, recoloured in the Graceful Minds palette (2026-10-02):
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

/**
 * The full Graceful Minds logo with its slogan. Demist IS Graceful Minds, so
 * this stands on its own: no "in partnership with" framing around it.
 *
 * Two files, not one: the plum script wordmark disappears on the dark theme's
 * plum-black page, so graceful-minds-logo-dark.png has the wordmark and slogan
 * in light lavender (the watercolour is untouched). A white plate behind the
 * logo would have worked too, but reads as a pasted-in sticker.
 *
 * The slogan is lettering, so it needs width to stay readable: about 240px is
 * the floor. The source is 461x454, so anything over ~230px is upscaled on a
 * retina screen; ask Graceful Minds for a larger original if it looks soft.
 */
export function GracefulMindsLogo({ width = 280, className = '' }: { width?: number; className?: string }) {
  const height = Math.round(width * (454 / 461))
  const img = (src: string, cls: string) => (
    <Image src={src} alt="" width={width} height={height} className={cls} style={{ width, height }} />
  )
  return (
    <a
      href="https://www.graceful-minds.org"
      target="_blank"
      rel="noopener"
      aria-label="Graceful Minds: we don't change how you think, we change how you succeed"
      className={`block w-fit rounded-2xl transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 ${className}`}
    >
      {img('/graceful-minds-logo.png', 'block dark:hidden')}
      {img('/graceful-minds-logo-dark.png', 'hidden dark:block')}
    </a>
  )
}
