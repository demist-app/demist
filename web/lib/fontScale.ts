// User-adjustable text size for reading surfaces (live transcript, term
// definitions, session summaries). Device-local, not a profile column —
// readability preference tends to depend on the screen someone's using.

export type FontScale = 'sm' | 'md' | 'lg'

export const FONT_SCALE_VALUES: Record<FontScale, number> = { sm: 0.9, md: 1, lg: 1.15 }
export const FONT_SCALE_LABELS: Record<FontScale, string> = { sm: 'Small', md: 'Medium', lg: 'Large' }

const STORAGE_KEY = 'demist_font_scale'

export function getFontScale(): FontScale {
  if (typeof window === 'undefined') return 'md'
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved === 'sm' || saved === 'lg' ? saved : 'md'
}

export function setFontScale(scale: FontScale) {
  localStorage.setItem(STORAGE_KEY, scale)
  document.documentElement.style.setProperty('--df-scale', String(FONT_SCALE_VALUES[scale]))
}

export function applyStoredFontScale() {
  document.documentElement.style.setProperty('--df-scale', String(FONT_SCALE_VALUES[getFontScale()]))
}
