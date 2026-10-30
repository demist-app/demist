// A short tap-through after the sign-up questions, once per phone: how a
// lecture works, then an offer of greyscale. Asked for by the founder on
// 2026-10-30 so new students know what to do on their first lecture.
//
// The greyscale slide makes no research claim on purpose: the evidence that
// greyscale helps neurodivergent people specifically is one seven-person
// study, so the copy says what people report instead.
import { useState, type ReactNode } from 'react'
import { Pressable, Switch, View } from 'react-native'
import { usePrefs } from '../lib/prefs'
import { capture } from '../lib/analytics'
import { Button, Card, Screen, T } from '../components/ui'
import { BookIcon, FlagIcon, MicIcon } from '../components/icons'

interface Slide { icon: (color: string) => ReactNode; title: string; body: string }

const SLIDES: Slide[] = [
  {
    icon: color => <MicIcon color={color} size={38} />,
    title: 'Press record when the lecture starts',
    body: 'Your phone writes down what the lecturer says, as they say it. Lock it and put it away if you like. Demist keeps listening, and the sound never leaves your phone.',
  },
  {
    icon: color => <BookIcon color={color} size={38} />,
    title: 'New words, explained as they come up',
    body: 'When a technical word is said, a short card explains it in plain language. Tap a card to keep it open. Every word goes into your Glossary and becomes a flashcard.',
  },
  {
    icon: color => <FlagIcon color={color} size={38} />,
    title: 'Lost? Tap I’m lost',
    body: 'It marks the moment without stopping anything. After the lecture, you can see what was said around it, with the words explained.',
  },
]
const LAST = SLIDES.length // the greyscale slide comes after these

export default function Intro() {
  const { c, prefs, setPrefs } = usePrefs()
  const [step, setStep] = useState(0)

  const finish = (skipped: boolean) => {
    capture('intro_completed', { platform: 'ios', skipped, at_step: step, greyscale: prefs.greyscale })
    setPrefs({ introSeen: true })
  }

  const slide = SLIDES[step]
  return (
    <Screen scroll={false} edges={['top', 'bottom']} style={{ maxWidth: 480 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', minHeight: 44, alignItems: 'center' }}>
        {step < LAST ? (
          <Pressable onPress={() => finish(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip the introduction">
            <T weight={600} tone="muted">Skip</T>
          </Pressable>
        ) : null}
      </View>

      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 18 }} accessibilityLiveRegion="polite">
        {slide ? (
          <>
            <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              {slide.icon(c.accent)}
            </View>
            <T size={26} weight={700} center>{slide.title}</T>
            <T size={16} tone="muted" center style={{ maxWidth: 360 }}>{slide.body}</T>
          </>
        ) : (
          <>
            {/* Three colour dots that turn grey with the switch, so the
                change is seen, not just described. */}
            <View style={{ flexDirection: 'row', gap: 10 }} accessible={false}>
              {[c.accentSolid, c.calm, c.danger].map((col, i) => (
                <View key={i} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: col }} />
              ))}
            </View>
            <T size={26} weight={700} center>Make the screen calmer</T>
            <T size={16} tone="muted" center style={{ maxWidth: 360 }}>
              Many neurodivergent people find colour on screens distracting or tiring. Greyscale takes the colour out so the words stand out. Try it and see how it feels.
            </T>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', marginTop: 6 }}>
              <T weight={600} style={{ flex: 1 }}>Greyscale</T>
              <Switch value={prefs.greyscale} onValueChange={v => setPrefs({ greyscale: v })} accessibilityLabel="Greyscale"
                trackColor={{ true: c.accentSolid, false: c.surface2 }} ios_backgroundColor={c.surface2} />
            </Card>
            <T size={13} tone="faint" center>You can change this anytime in Settings.</T>
          </>
        )}
      </View>

      <View style={{ gap: 18, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }} accessibilityLabel={`Step ${step + 1} of ${LAST + 1}`} accessible>
          {Array.from({ length: LAST + 1 }, (_, i) => (
            <View key={i} style={{ width: i === step ? 20 : 8, height: 8, borderRadius: 4, backgroundColor: i === step ? c.accent : c.borderStrong }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {step > 0 ? <Button kind="secondary" label="Back" onPress={() => setStep(s => s - 1)} style={{ minHeight: 56 }} /> : null}
          <Button
            label={step < LAST ? 'Next' : 'Start using Demist'}
            onPress={() => (step < LAST ? setStep(s => s + 1) : finish(false))}
            style={{ flex: 1, minHeight: 56 }}
          />
        </View>
      </View>
    </Screen>
  )
}
