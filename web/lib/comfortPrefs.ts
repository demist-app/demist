'use client'

// Reading comfort and calm settings (2026-10-07). Device-local, like the text
// size in fontScale.ts: what is comfortable depends on the screen in front of
// you, and none of it is worth a profile column.
//
// - font:     the whole app's typeface. Atkinson Hyperlegible (Braille
//             Institute, letterforms that cannot be mistaken for each other)
//             and Lexend (designed to reduce visual stress) are the two
//             alternatives needs assessments most often ask about.
// - spacing:  extra line and word spacing on reading surfaces (transcript,
//             definitions, summaries: anything sized with --df-scale).
// - tint:     a coloured overlay across the whole screen, the on-screen
//             version of the coloured overlays many dyslexic readers use.
//             Light mode only; on a dark page it would just muddy the colours.
// - progress: day streaks. OFF by default: for an anxious
//             student "Streak: 0 days" is pressure and guilt, not motivation.

import { useEffect, useState } from 'react'

export type ReadingFont = 'standard' | 'atkinson' | 'lexend'
export type Spacing = 'normal' | 'relaxed'
export type Tint = 'none' | 'cream' | 'blue' | 'green' | 'rose'

export interface ComfortPrefs {
  font: ReadingFont
  spacing: Spacing
  tint: Tint
  showProgress: boolean
}

export const DEFAULT_COMFORT: ComfortPrefs = { font: 'standard', spacing: 'normal', tint: 'none', showProgress: false }

export const FONT_OPTIONS: { value: ReadingFont; label: string; sample: string }[] = [
  { value: 'standard', label: 'Standard', sample: "'Plus Jakarta Sans Variable', sans-serif" },
  { value: 'atkinson', label: 'Atkinson Hyperlegible', sample: "'Atkinson Hyperlegible', sans-serif" },
  { value: 'lexend', label: 'Lexend', sample: "'Lexend Variable', sans-serif" },
]

export const TINT_OPTIONS: { value: Tint; label: string; swatch: string }[] = [
  { value: 'none', label: 'None', swatch: 'transparent' },
  { value: 'cream', label: 'Cream', swatch: '#FFF1C8' },
  { value: 'blue', label: 'Blue', swatch: '#D3E4FF' },
  { value: 'green', label: 'Green', swatch: '#D6F2DC' },
  { value: 'rose', label: 'Rose', swatch: '#FFDCE4' },
]

const KEY = 'demist_comfort'
const EVENT = 'demist-comfort-change'

export function getComfort(): ComfortPrefs {
  if (typeof window === 'undefined') return DEFAULT_COMFORT
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ComfortPrefs>
    return {
      font: raw.font === 'atkinson' || raw.font === 'lexend' ? raw.font : 'standard',
      spacing: raw.spacing === 'relaxed' ? 'relaxed' : 'normal',
      tint: TINT_OPTIONS.some(t => t.value === raw.tint) ? raw.tint as Tint : 'none',
      showProgress: raw.showProgress === true,
    }
  } catch {
    return DEFAULT_COMFORT
  }
}

/** Sets the html attributes globals.css keys off. Safe to call repeatedly. */
export function applyComfort(p: ComfortPrefs = getComfort()) {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.dataset.readFont = p.font
  el.dataset.spacing = p.spacing
  el.dataset.tint = p.tint
}

export function setComfort(patch: Partial<ComfortPrefs>) {
  const next = { ...getComfort(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: applies for this visit only */ }
  applyComfort(next)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }))
}

/** Live view of the prefs, so a change in Settings updates every open screen. */
export function useComfort(): ComfortPrefs {
  const [prefs, setPrefs] = useState<ComfortPrefs>(DEFAULT_COMFORT)
  useEffect(() => {
    setPrefs(getComfort())
    const onChange = () => setPrefs(getComfort())
    window.addEventListener(EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])
  return prefs
}
