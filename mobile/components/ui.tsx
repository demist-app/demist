// Small shared pieces. Every bit of text goes through <T> so the reading font,
// text size and spacing from Settings apply everywhere, as on the web.
import { useEffect, useState, type ReactNode } from 'react'
import {
  ActivityIndicator, Pressable, ScrollView, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'
import * as Speech from 'expo-speech'
import { usePrefs } from '../lib/prefs'
import { radius } from '../lib/theme'
import { SpeakerIcon, StopIcon } from './icons'

type Weight = 400 | 500 | 600 | 700
type Tone = 'fg' | 'muted' | 'faint' | 'accent' | 'calm' | 'danger' | 'onAccent'

export function T({ children, size = 15, weight = 400, tone = 'fg', style, center, numberOfLines, selectable }: {
  children: ReactNode; size?: number; weight?: Weight; tone?: Tone
  style?: StyleProp<TextStyle>; center?: boolean; numberOfLines?: number; selectable?: boolean
}) {
  const { c, font, size: sz, lh, letterSpacing } = usePrefs()
  const color = { fg: c.fg, muted: c.fgMuted, faint: c.fgFaint, accent: c.accent, calm: c.calm, danger: c.danger, onAccent: c.onAccent }[tone]
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      maxFontSizeMultiplier={1.6}
      style={[{ fontFamily: font(weight), fontSize: sz(size), lineHeight: lh(size), color, letterSpacing }, center && { textAlign: 'center' }, style]}
    >
      {children}
    </Text>
  )
}

// Every text box goes through this. React Native 0.85 reuses native text
// inputs between screens, and a reused one keeps the last letter spacing it
// was given unless the new one sets its own: the sign-in code box's spacing
// turned up in the Record screen's placeholder as "C o m p u t e r"
// (first iPhone test, 2026-10-30). So spacing is always set explicitly.
export function Input({ style, ...props }: TextInputProps & { ref?: React.Ref<TextInput> }) {
  const { c } = usePrefs()
  return <TextInput placeholderTextColor={c.fgFaint} maxFontSizeMultiplier={1.6} {...props} style={[{ letterSpacing: 0, textAlign: 'left' }, style]} />
}

export function Screen({ children, scroll = true, edges = ['top'], style }: {
  children: ReactNode; scroll?: boolean; edges?: Edge[]; style?: StyleProp<ViewStyle>
}) {
  const { c } = usePrefs()
  const inner = [{ paddingHorizontal: 20, paddingBottom: 32, width: '100%' as const, maxWidth: 720, alignSelf: 'center' as const }, style]
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll
        ? <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        : <View style={[{ flex: 1 }, ...inner]}>{children}</View>}
    </SafeAreaView>
  )
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View style={{ paddingTop: 16, paddingBottom: 20 }}>
      <T size={28} weight={700} style={{ letterSpacing: -0.4 }}>{children}</T>
      {sub ? <T tone="muted" style={{ marginTop: 4 }}>{sub}</T> : null}
    </View>
  )
}

export function Card({ children, style, onPress, accessibilityLabel }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string
}) {
  const { c } = usePrefs()
  const base: ViewStyle = {
    backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: 16,
    shadowColor: '#1E1433', shadowOpacity: c.dark ? 0 : 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  }
  if (!onPress) return <View style={[base, style]}>{children}</View>
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, style, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  )
}

export function Button({ label, onPress, kind = 'primary', loading, disabled, icon, style, accessibilityHint }: {
  label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'quiet' | 'danger'
  loading?: boolean; disabled?: boolean; icon?: ReactNode; style?: StyleProp<ViewStyle>; accessibilityHint?: string
} & Pick<PressableProps, 'onLongPress'>) {
  const { c } = usePrefs()
  const bg = { primary: c.accentSolid, secondary: c.surface2, quiet: 'transparent', danger: c.dangerSoft }[kind]
  const tone: Tone = kind === 'primary' ? 'onAccent' : kind === 'danger' ? 'danger' : kind === 'quiet' ? 'accent' : 'fg'
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [{
        backgroundColor: bg, borderRadius: radius.lg, minHeight: 52, paddingHorizontal: 18,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        borderWidth: kind === 'secondary' ? 1 : 0, borderColor: c.border,
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
      }, style]}
    >
      {loading ? <ActivityIndicator color={kind === 'primary' ? '#fff' : c.accent} /> : (
        <>{icon}<T weight={600} tone={tone}>{label}</T></>
      )}
    </Pressable>
  )
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { c } = usePrefs()
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label}
      style={{
        paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 999, borderWidth: 1,
        borderColor: selected ? c.accentBorder : c.border, backgroundColor: selected ? c.accentSoft : c.surface,
      }}>
      <T size={14} weight={selected ? 600 : 500} tone={selected ? 'accent' : 'fg'}>{label}</T>
    </Pressable>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <T size={12} weight={600} tone="faint" style={{ textTransform: 'uppercase', letterSpacing: 1, marginTop: 24, marginBottom: 10 }}>{children}</T>
}

export function Loading() {
  const { c } = usePrefs()
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}><ActivityIndicator color={c.accent} /></View>
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center', gap: 6 }}>
      <T size={17} weight={600} center>{title}</T>
      {body ? <T tone="muted" center style={{ maxWidth: 320 }}>{body}</T> : null}
    </View>
  )
}

// Read aloud, as on the web (ReadAloudButton): British English, one voice at
// a time. expo-speech is the system voice, on the device.
let speakingOwner: (() => void) | null = null
export function ReadAloud({ text, label = 'Read aloud' }: { text: string; label?: string }) {
  const { c } = usePrefs()
  const [speaking, setSpeaking] = useState(false)
  useEffect(() => () => { if (speaking) void Speech.stop() }, [speaking])
  const toggle = () => {
    if (speaking) { void Speech.stop(); setSpeaking(false); return }
    speakingOwner?.()
    void Speech.stop()
    setSpeaking(true)
    speakingOwner = () => setSpeaking(false)
    Speech.speak(text, {
      language: 'en-GB', rate: 0.95,
      onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false), onError: () => setSpeaking(false),
    })
  }
  return (
    <Pressable onPress={toggle} hitSlop={10} accessibilityRole="button" accessibilityLabel={speaking ? 'Stop reading' : label}
      style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft }}>
      {speaking ? <StopIcon color={c.accent} size={14} /> : <SpeakerIcon color={c.accent} size={16} />}
    </Pressable>
  )
}
