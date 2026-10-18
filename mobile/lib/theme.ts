// Graceful Minds palette, the same tokens as web/app/globals.css (:root and
// .dark). Light is the default, as on the web.
export interface Palette {
  bg: string
  bgSubtle: string
  fg: string
  fgMuted: string
  fgFaint: string
  surface: string
  surface2: string
  border: string
  borderStrong: string
  accent: string
  accentSoft: string
  accentBorder: string
  accentSolid: string
  onAccent: string
  calm: string
  calmSoft: string
  danger: string
  dangerSoft: string
  tabBar: string
  dark: boolean
}

export const light: Palette = {
  bg: '#F3F0F8',
  bgSubtle: '#ECE8F4',
  fg: '#1E1433',
  fgMuted: 'rgba(30,20,51,0.68)',
  fgFaint: 'rgba(30,20,51,0.45)',
  surface: '#FFFFFF',
  surface2: '#FFFFFF',
  border: 'rgba(30,20,51,0.10)',
  borderStrong: 'rgba(30,20,51,0.20)',
  accent: '#5B3F8F',
  accentSoft: 'rgba(91,63,143,0.08)',
  accentBorder: 'rgba(91,63,143,0.28)',
  accentSolid: '#5B3F8F',
  onAccent: '#FFFFFF',
  calm: '#2A777A',
  calmSoft: 'rgba(42,119,122,0.10)',
  danger: '#B4383F',
  dangerSoft: 'rgba(180,56,63,0.08)',
  tabBar: 'rgba(243,240,248,0.97)',
  dark: false,
}

export const dark: Palette = {
  bg: '#110B1C',
  bgSubtle: '#171024',
  fg: '#EEEAF6',
  fgMuted: 'rgba(238,234,246,0.60)',
  fgFaint: 'rgba(238,234,246,0.34)',
  surface: 'rgba(255,255,255,0.045)',
  surface2: 'rgba(255,255,255,0.08)',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.15)',
  accent: '#C3B2EA',
  accentSoft: 'rgba(195,178,234,0.10)',
  accentBorder: 'rgba(195,178,234,0.28)',
  accentSolid: '#7457AF',
  onAccent: '#FFFFFF',
  calm: '#7CC9C0',
  calmSoft: 'rgba(124,201,192,0.12)',
  danger: '#F09A9F',
  dangerSoft: 'rgba(240,154,159,0.10)',
  tabBar: 'rgba(17,11,28,0.97)',
  dark: true,
}

// Reading-comfort tints (web: html[data-tint]), light mode only, as on the web.
export const TINTS = {
  none: null,
  cream: '#FBF3DC',
  blue: '#E3EEF9',
  green: '#E4F2E6',
  rose: '#F8E6EA',
} as const
export type Tint = keyof typeof TINTS

export const radius = { sm: 10, md: 14, lg: 18, xl: 24 }
export const space = (n: number) => n * 4
