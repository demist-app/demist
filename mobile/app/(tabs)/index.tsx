import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRecording, openSettings } from '../../lib/recording'
import { useAccount } from '../../lib/account'
import { usePrefs, LECTURE_LANGUAGES } from '../../lib/prefs'
import { radius } from '../../lib/theme'
import { Button, Card, ReadAloud, T, Input } from '../../components/ui'
import { clockFromMs } from '../../lib/format'
import { CheckIcon, ChevronIcon, CloseIcon, FlagIcon, MicIcon, StopIcon } from '../../components/icons'

// Five bars in the shape of the Demist mark, moving gently with the room's
// sound. Purely visual: nothing about recording depends on it.
function Level({ level }: { level: number }) {
  const { c } = usePrefs()
  const shape = [0.45, 0.75, 1, 0.75, 0.45]
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 22 }} accessible={false}>
      {shape.map((k, i) => (
        <View key={i} style={{ width: 4, borderRadius: 2, backgroundColor: i === 2 ? c.calm : c.accent, height: 6 + 16 * k * Math.max(0.15, level) }} />
      ))}
    </View>
  )
}

export default function Record() {
  const rec = useRecording()
  const { profile } = useAccount()
  const { c, font, size, prefs, setPrefs } = usePrefs()
  const scrollRef = useRef<ScrollView>(null)
  const [langOpen, setLangOpen] = useState(false)
  const [wordsOpen, setWordsOpen] = useState(false)
  const wordCount = rec.sessionTerms.length
  const langLabel = LECTURE_LANGUAGES.find(l => l.value === prefs.lectureLanguage)?.label ?? 'English'

  // The student's course fills the box as real text, once. Shown as a faint
  // placeholder it looked filled in but read as a hint; cleared, it stays
  // cleared (the recording still falls back to the course).
  const prefilled = useRef(false)
  useEffect(() => {
    if (prefilled.current || !profile?.course || rec.subject || rec.status !== 'idle') return
    prefilled.current = true
    rec.setSubject(profile.course)
  }, [profile?.course])

  useEffect(() => {
    if (rec.finishedSessionId) {
      const id = rec.finishedSessionId
      rec.clearFinished()
      router.push({ pathname: '/session/[id]', params: { id, fresh: '1' } })
    }
  }, [rec.finishedSessionId])

  const live = rec.status === 'recording' || rec.status === 'stopping'

  if (!live) {
    return (
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, maxWidth: 560, width: '100%', alignSelf: 'center', flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
            <T size={28} weight={700} style={{ marginBottom: 6 }}>Record a lecture</T>
            <T tone="muted" style={{ marginBottom: 24 }}>New words are explained as they come up, and everything is saved for later.</T>

            <T size={13} weight={600} tone="muted" style={{ marginBottom: 8 }}>Module or subject</T>
            <Input
              value={rec.subject}
              onChangeText={rec.setSubject}
              placeholder="e.g. Cell Biology"
              style={{
                backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg,
                paddingHorizontal: 16, paddingVertical: 14, color: c.fg, fontSize: size(16), fontFamily: font(500),
              }}
              returnKeyType="done"
              accessibilityLabel="Module or subject"
            />

            {/* Set once and rarely changed, so one quiet row rather than a
                row of buttons competing with the record button. */}
            <Pressable onPress={() => setLangOpen(true)} accessibilityRole="button"
              accessibilityLabel={`Lecture language, ${langLabel}`} accessibilityHint="Changes the language the lecture is written down in"
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
              <T size={14} tone="muted">Lecture language</T>
              <T size={14} weight={600} tone="accent" style={{ marginLeft: 'auto' }}>{langLabel}</T>
              <ChevronIcon color={c.accent} size={16} />
            </Pressable>

            <Modal visible={langOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLangOpen(false)}>
              <View style={{ flex: 1, backgroundColor: c.bg, padding: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <T size={22} weight={700} style={{ flex: 1 }}>Lecture language</T>
                  <Pressable onPress={() => setLangOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close"
                    style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface2 }}>
                    <CloseIcon color={c.fgMuted} />
                  </Pressable>
                </View>
                <T tone="muted" style={{ marginBottom: 16 }}>The language your lecturer speaks. Your phone needs to know it to write the lecture down.</T>
                <Card style={{ paddingVertical: 4 }}>
                  {LECTURE_LANGUAGES.map((l, i) => {
                    const selected = prefs.lectureLanguage === l.value
                    return (
                      <Pressable key={l.value} onPress={() => { setPrefs({ lectureLanguage: l.value }); setLangOpen(false) }}
                        accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={l.label}
                        style={({ pressed }) => ({
                          flexDirection: 'row', alignItems: 'center', minHeight: 52, opacity: pressed ? 0.6 : 1,
                          borderTopWidth: i ? 1 : 0, borderTopColor: c.border,
                        })}>
                        <T weight={selected ? 600 : 400} tone={selected ? 'accent' : 'fg'} style={{ flex: 1 }}>{l.label}</T>
                        {selected ? <CheckIcon color={c.accent} /> : null}
                      </Pressable>
                    )
                  })}
                </Card>
              </View>
            </Modal>

            <View style={{ alignItems: 'center', marginTop: 40, marginBottom: 28 }}>
              <Pressable
                onPress={rec.start}
                disabled={rec.status === 'starting'}
                accessibilityRole="button"
                accessibilityLabel="Start recording"
                style={({ pressed }) => ({
                  width: 132, height: 132, borderRadius: 66, backgroundColor: c.accentSolid,
                  alignItems: 'center', justifyContent: 'center', opacity: rec.status === 'starting' ? 0.6 : pressed ? 0.85 : 1,
                  shadowColor: c.accentSolid, shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 10 },
                })}
              >
                <MicIcon color="#fff" size={44} />
              </Pressable>
              <T weight={600} style={{ marginTop: 16 }}>{rec.status === 'starting' ? 'Getting ready…' : 'Tap to start'}</T>
            </View>

            {rec.error ? (
              <Card style={{ backgroundColor: c.dangerSoft, borderColor: 'transparent', gap: 12 }}>
                <T tone="fg">{rec.error}</T>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button kind="secondary" label="Open Settings" onPress={openSettings} style={{ flex: 1, minHeight: 44 }} />
                  <Button kind="quiet" label="Dismiss" onPress={rec.clearError} style={{ minHeight: 44 }} />
                </View>
              </Card>
            ) : rec.notice ? (
              <Card><T tone="muted">{rec.notice}</T></Card>
            ) : (
              <View style={{ gap: 8 }}>
                <T size={13} tone="muted" center>Your phone writes the lecture down by itself. The sound never leaves it.</T>
                <T size={13} tone="muted" center>You can lock your phone. Demist keeps listening.</T>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    )
  }

  const text = rec.transcript
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
        {/* Status row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Level level={rec.level} />
            <T weight={600} tone="calm">{rec.status === 'stopping' ? 'Saving…' : 'Listening'}</T>
          </View>
          <T weight={600} tone="muted" style={{ fontVariant: ['tabular-nums'] }} >{clockFromMs(rec.elapsedMs)}</T>
        </View>
        {rec.subject || profile?.course || wordCount ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginTop: -6, marginBottom: 6, minHeight: 32 }}>
            <T size={13} tone="faint" numberOfLines={1} style={{ flex: 1 }}>{rec.subject || profile?.course || ''}</T>
            {wordCount ? (
              <Pressable onPress={() => setWordsOpen(true)} accessibilityRole="button" accessibilityLabel={`${wordCount} new ${wordCount === 1 ? 'word' : 'words'} so far. Show them`}
                hitSlop={8} style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, minHeight: 32, borderRadius: 999,
                  backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.accentBorder, opacity: pressed ? 0.7 : 1,
                })}>
                <T size={13} weight={600} tone="accent">{wordCount} new {wordCount === 1 ? 'word' : 'words'}</T>
                <ChevronIcon color={c.accent} size={14} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Every word from this lecture so far, newest first. Cards make room
            for each other; nothing is lost, it is all here. */}
        <Modal visible={wordsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setWordsOpen(false)}>
          <View style={{ flex: 1, backgroundColor: c.bg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 4 }}>
              <T size={22} weight={700} style={{ flex: 1 }}>New words so far</T>
              <Pressable onPress={() => setWordsOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close"
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface2 }}>
                <CloseIcon color={c.fgMuted} />
              </Pressable>
            </View>
            <T size={13} tone="muted" style={{ paddingHorizontal: 20, marginBottom: 12 }}>Still listening. These are saved to your Glossary too.</T>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 8 }}>
              {rec.sessionTerms.map(t => (
                <Card key={t.term} style={{ padding: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <T weight={700} tone="accent">{t.term}</T>
                      <T size={15} style={{ marginTop: 2 }}>{t.definition}</T>
                    </View>
                    <ReadAloud text={`${t.term}. ${t.definition}`} />
                  </View>
                </Card>
              ))}
            </ScrollView>
          </View>
        </Modal>

        {/* Transcript */}
        <ScrollView
          ref={scrollRef}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          accessibilityLabel="Live transcript"
        >
          {!text && !rec.interim ? (
            <T tone="faint" style={{ marginTop: 24 }}>Words will appear here as the lecturer speaks.</T>
          ) : (
            <T size={17} selectable>
              {text}{text && rec.interim ? ' ' : ''}<T size={17} tone="faint">{rec.interim}</T>
            </T>
          )}
        </ScrollView>

        {/* Term cards */}
        {rec.cards.length > 0 && (
          // Compact: two lines of definition, tap to open the rest. At most
          // three cards, so the transcript always keeps most of the screen.
          <View style={{ paddingHorizontal: 16, gap: 6, paddingBottom: 6 }} accessibilityLiveRegion="polite">
            {rec.cards.map(card => (
              <Card key={card.id} onPress={() => rec.pinCard(card.id)}
                accessibilityLabel={`${card.term}. ${card.definition}. ${card.pinned ? 'Tap to shorten' : 'Tap to read all and keep it here'}`}
                style={{ borderColor: c.accentBorder, paddingVertical: 10, paddingHorizontal: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <T size={15} weight={700} tone="accent" numberOfLines={1}>{card.term}</T>
                    <T size={14} tone="muted" style={{ marginTop: 1 }} numberOfLines={card.pinned ? undefined : 2}>{card.definition}</T>
                  </View>
                  <ReadAloud text={`${card.term}. ${card.definition}`} />
                  <Pressable onPress={() => rec.dismissCard(card.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Close ${card.term}`}
                    style={{ width: 32, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                    <CloseIcon color={c.fgFaint} />
                  </Pressable>
                </View>
              </Card>
            ))}
          </View>
        )}

        {rec.notice ? <T size={13} tone="muted" style={{ paddingHorizontal: 20, paddingBottom: 6 }}>{rec.notice}</T> : null}

        {/* Controls */}
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderTopWidth: 1, borderTopColor: c.border }}>
          <Button
            kind="secondary"
            style={{ flex: 1, minHeight: 60 }}
            label={rec.lostCount ? `I'm lost (${rec.lostCount})` : "I'm lost"}
            accessibilityHint="Marks this moment so you can come back to it after the lecture"
            icon={<FlagIcon color={c.accent} />}
            onPress={rec.markLost}
            disabled={rec.status !== 'recording'}
          />
          <Button
            style={{ minHeight: 60, paddingHorizontal: 22 }}
            label="Stop"
            icon={<StopIcon color="#fff" size={14} />}
            loading={rec.status === 'stopping'}
            onPress={rec.stop}
          />
        </View>
      </View>
    </SafeAreaView>
  )
}
