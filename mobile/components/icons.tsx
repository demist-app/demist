import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg'
import type { ColorValue } from 'react-native'

type P = { color: ColorValue; size?: number }
const stroke = (color: ColorValue) => ({ fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const })

export const MicIcon = ({ color, size = 24 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color)}>
    <Rect x="9" y="2" width="6" height="12" rx="3" />
    <Path d="M5 10a7 7 0 0 0 14 0" /><Line x1="12" y1="17" x2="12" y2="22" />
  </Svg>
)
export const BookIcon = ({ color, size = 24 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color)}>
    <Path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" /><Path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
  </Svg>
)
export const CardsIcon = ({ color, size = 24 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color)}>
    <Rect x="2" y="5" width="20" height="14" rx="3" /><Line x1="2" y1="10" x2="22" y2="10" />
  </Svg>
)
export const ClockIcon = ({ color, size = 24 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color)}>
    <Circle cx="12" cy="12" r="9" /><Polyline points="12 7 12 12 15 14" />
  </Svg>
)
export const GearIcon = ({ color, size = 24 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color)}>
    <Circle cx="12" cy="12" r="3" />
    <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
)
export const SpeakerIcon = ({ color, size = 24 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color)}>
    <Path d="M11 5 6 9H2v6h4l5 4V5z" /><Path d="M15.5 8.5a5 5 0 0 1 0 7" /><Path d="M19 5a10 10 0 0 1 0 14" />
  </Svg>
)
export const StopIcon = ({ color, size = 24 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Rect x="5" y="5" width="14" height="14" rx="3" fill={color} /></Svg>
)
export const ChevronIcon = ({ color, size = 18 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color)}><Polyline points="9 6 15 12 9 18" /></Svg>
)
export const BackIcon = ({ color, size = 22 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color)}><Polyline points="15 6 9 12 15 18" /></Svg>
)
export const FlagIcon = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color)}>
    <Path d="M4 22V4" /><Path d="M4 4h12l-2 4 2 4H4" />
  </Svg>
)
export const CloseIcon = ({ color, size = 16 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color)}>
    <Line x1="6" y1="6" x2="18" y2="18" /><Line x1="18" y1="6" x2="6" y2="18" />
  </Svg>
)
