// Reading comfort and appearance, the phone's version of web/lib/comfortPrefs.ts.
// Stored on the device only (AsyncStorage), like the web's localStorage copy:
// these are how the screen looks to one person, not account data.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getLocales } from 'expo-localization'
import { light, dark, TINTS, type Palette, type Tint } from './theme'
import type { LectureLanguage } from './shared/lectureLanguage'

export type ReadingFont = 'standard' | 'atkinson' | 'lexend'
export type Spacing = 'normal' | 'relaxed'
export type Appearance = 'system' | 'light' | 'dark'
export type TextSize = 'small' | 'default' | 'large' | 'larger'

export interface Prefs {
  font: ReadingFont
  spacing: Spacing
  tint: Tint
  appearance: Appearance
  textSize: TextSize
  showProgress: boolean
  /** Every colour in shades of grey, for students who find colour too much. */
  greyscale: boolean
  /** The language lectures are given in. Apple's speech recognition must be
   *  told up front; it cannot detect it. */
  lectureLanguage: LectureLanguage
  /** The tap-through introduction has been seen on this phone. */
  introSeen: boolean
}

// Each language named in itself, so a student who does not read English can
// still find theirs.
export const LECTURE_LANGUAGES: { value: LectureLanguage; label: string }[] = [
  { value: 'en', label: 'English' }, { value: 'fr', label: 'Français' }, { value: 'nl', label: 'Nederlands' },
  { value: 'de', label: 'Deutsch' }, { value: 'es', label: 'Español' }, { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Português' },
]

function deviceLectureLanguage(): LectureLanguage {
  const code = getLocales()[0]?.languageCode ?? 'en'
  return LECTURE_LANGUAGES.some(l => l.value === code) ? code as LectureLanguage : 'en'
}

export const DEFAULT_PREFS: Prefs = {
  font: 'standard', spacing: 'normal', tint: 'none', appearance: 'system', textSize: 'default', showProgress: false, greyscale: false,
  lectureLanguage: deviceLectureLanguage(),
  introSeen: false,
}

export const FONT_OPTIONS: { value: ReadingFont; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'atkinson', label: 'Atkinson Hyperlegible' },
  { value: 'lexend', label: 'Lexend' },
]
export const TINT_OPTIONS: { value: Tint; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'cream', label: 'Cream' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'rose', label: 'Rose' },
]
export const TEXT_SIZES: { value: TextSize; label: string; scale: number }[] = [
  { value: 'small', label: 'Small', scale: 0.92 },
  { value: 'default', label: 'Default', scale: 1 },
  { value: 'large', label: 'Large', scale: 1.12 },
  { value: 'larger', label: 'Larger', scale: 1.25 },
]

type Weight = 400 | 500 | 600 | 700
export const FAMILIES: Record<ReadingFont, Record<Weight, string>> = {
  standard: { 400: 'PlusJakartaSans_400Regular', 500: 'PlusJakartaSans_500Medium', 600: 'PlusJakartaSans_600SemiBold', 700: 'PlusJakartaSans_700Bold' },
  // Atkinson ships two weights; the in-between ones round to the nearer.
  atkinson: { 400: 'AtkinsonHyperlegible_400Regular', 500: 'AtkinsonHyperlegible_400Regular', 600: 'AtkinsonHyperlegible_700Bold', 700: 'AtkinsonHyperlegible_700Bold' },
  lexend: { 400: 'Lexend_400Regular', 500: 'Lexend_500Medium', 600: 'Lexend_600SemiBold', 700: 'Lexend_700Bold' },
}

const KEY = 'demist_prefs'

interface Ctx {
  prefs: Prefs
  setPrefs: (patch: Partial<Prefs>) => void
  c: Palette
  /** Font family for a weight, in the student's chosen reading font. */
  font: (w?: Weight) => string
  /** Scales a font size by the chosen text size. */
  size: (px: number) => number
  /** Line height for a font size, looser when spacing is relaxed. */
  lh: (px: number) => number
  letterSpacing: number
  lectureLanguage: LectureLanguage
  /** False until saved prefs are read, so nothing routes on the defaults. */
  loaded: boolean
}

const PrefsContext = createContext<Ctx | null>(null)

// The palette with every colour replaced by the grey of the same perceived
// lightness (Rec. 709 luma), keeping each colour's transparency.
function toGrey(color: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  const rgba = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i.exec(color)
  let r: number, g: number, b: number, a = 1
  if (hex) { const n = parseInt(hex[1], 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255 }
  else if (rgba) { r = +rgba[1]; g = +rgba[2]; b = +rgba[3]; a = rgba[4] ? +rgba[4] : 1 }
  else return color
  const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
  return a === 1 ? `rgb(${y},${y},${y})` : `rgba(${y},${y},${y},${a})`
}
function greyscalePalette(p: Palette): Palette {
  const out = { ...p }
  for (const k of Object.keys(out) as (keyof Palette)[]) {
    if (typeof out[k] === 'string') (out as Record<string, unknown>)[k] = toGrey(out[k] as string)
  }
  return out
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS)
  const [loaded, setLoaded] = useState(false)
  const scheme = useColorScheme()

  useEffect(() => {
    AsyncStorage.getItem(KEY).then(raw => {
      if (!raw) return
      try { setPrefsState({ ...DEFAULT_PREFS, ...JSON.parse(raw) }) } catch { /* keep defaults */ }
    }).catch(() => {}).finally(() => setLoaded(true))
  }, [])

  const value = useMemo<Ctx>(() => {
    const isDark = prefs.appearance === 'dark' || (prefs.appearance === 'system' && scheme === 'dark')
    let c = isDark ? dark : light
    // Tints are light-mode only, as on the web: a coloured overlay on a dark
    // page lowers contrast instead of easing glare.
    const tint = TINTS[prefs.tint]
    if (!isDark && tint) c = { ...c, bg: tint, bgSubtle: tint, tabBar: tint }
    // React Native's colour filters cannot greyscale on iOS, so greyscale is a
    // palette: every colour swapped for the grey of the same lightness. A tint
    // is colour too, so greyscale wins over it, as on the web.
    if (prefs.greyscale) c = greyscalePalette(isDark ? dark : light)
    const scale = TEXT_SIZES.find(t => t.value === prefs.textSize)?.scale ?? 1
    const relaxed = prefs.spacing === 'relaxed'
    return {
      prefs,
      setPrefs: (patch) => setPrefsState(prev => {
        const next = { ...prev, ...patch }
        AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {})
        return next
      }),
      c,
      font: (w = 400) => FAMILIES[prefs.font][w],
      size: (px) => Math.round(px * scale),
      lh: (px) => Math.round(px * scale * (relaxed ? 1.9 : 1.5)),
      letterSpacing: relaxed ? 0.3 : 0,
      lectureLanguage: prefs.lectureLanguage,
      loaded,
    }
  }, [prefs, scheme, loaded])

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export function usePrefs(): Ctx {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('usePrefs outside PrefsProvider')
  return ctx
}
