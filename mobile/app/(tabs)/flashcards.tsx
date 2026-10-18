// Same scheduling as the web flashcards (web/app/(app)/flashcards/page.tsx):
// cards that are due, then up to 15 new ones a day, graded Again/Hard/Good/
// Easy with the same SM-2 update, so a card reviewed on the phone comes up at
// the right time on the laptop and the other way round.
import { useCallback, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { useAccount } from '../../lib/account'
import { usePrefs } from '../../lib/prefs'
import { capture, reportWriteFailure } from '../../lib/analytics'
import { radius } from '../../lib/theme'
import { Button, Empty, Loading, ReadAloud, Screen, T, Title } from '../../components/ui'

const NEW_CARDS_PER_DAY = 15

interface FlashCard {
  id: string
  term: string
  definition: string
  sm2_interval: number | null
  sm2_ease: number | null
  sm2_review_count: number | null
}

type Grade = 0 | 1 | 2 | 3

function sm2Update(ease: number, interval: number, grade: Grade) {
  const newEase = Math.max(1.3, Math.min(3.0, ease + ([-0.2, -0.15, 0, 0.15] as const)[grade]))
  let newInterval: number
  if (grade === 0) newInterval = 1
  else if (grade === 1) newInterval = Math.max(1, Math.round(interval * 1.2))
  else if (grade === 2) newInterval = Math.max(1, Math.round(interval * ease))
  else newInterval = Math.max(1, Math.round(interval * ease * 1.3))
  return { interval: newInterval, ease: newEase }
}

const GRADES: { grade: Grade; label: string; hint: string }[] = [
  { grade: 0, label: 'Again', hint: 'Forgotten, show it again soon' },
  { grade: 1, label: 'Hard', hint: 'Remembered with difficulty' },
  { grade: 2, label: 'Good', hint: 'Remembered' },
  { grade: 3, label: 'Easy', hint: 'Remembered without effort' },
]

const COLS = 'id, term, definition, sm2_interval, sm2_ease, sm2_review_count'

export default function Flashcards() {
  const { session } = useAccount()
  const { c } = usePrefs()
  const [queue, setQueue] = useState<FlashCard[] | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [done, setDone] = useState(0)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const uid = session?.user.id
    if (!uid) return
    const now = new Date().toISOString()
    const [due, fresh] = await Promise.all([
      supabase.from('terms').select(COLS).eq('user_id', uid).eq('known', false).gt('sm2_review_count', 0).lte('sm2_due_at', now).order('sm2_due_at', { ascending: true }).limit(200),
      supabase.from('terms').select(COLS).eq('user_id', uid).eq('known', false).eq('sm2_review_count', 0).order('created_at', { ascending: true }).limit(NEW_CARDS_PER_DAY),
    ])
    setQueue([...((due.data as FlashCard[]) ?? []), ...((fresh.data as FlashCard[]) ?? [])])
    setFlipped(false)
    setDone(0)
  }, [session?.user.id])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const grade = async (g: Grade) => {
    const card = queue?.[0]
    const uid = session?.user.id
    if (!card || !uid || saving) return
    setSaving(true)
    const { interval, ease } = sm2Update(card.sm2_ease ?? 2.5, card.sm2_interval ?? 1, g)
    const { error } = await supabase.from('terms').update({
      sm2_interval: interval,
      sm2_ease: ease,
      sm2_due_at: new Date(Date.now() + interval * 86400000).toISOString(),
      sm2_review_count: (card.sm2_review_count ?? 0) + 1,
    }).eq('id', card.id)
    setSaving(false)
    if (reportWriteFailure('terms.sm2', error)) return
    capture('flashcard_graded', { grade: g, interval, isNew: !card.sm2_review_count, platform: 'ios' })
    void supabase.from('review_log').insert({ user_id: uid, term_id: card.id, grade: g, interval_before: card.sm2_interval, ease_before: card.sm2_ease })
      .then(({ error: e }) => { if (e) console.warn('review_log insert:', e.message) })
    // "Again" goes to the back of today's pile rather than leaving it.
    setQueue(prev => {
      if (!prev) return prev
      const [head, ...rest] = prev
      return g === 0 ? [...rest, { ...head, sm2_review_count: (head.sm2_review_count ?? 0) + 1, sm2_interval: interval, sm2_ease: ease }] : rest
    })
    setFlipped(false)
    setDone(d => d + 1)
  }

  if (!queue) return <Loading />

  const card = queue[0]
  if (!card) {
    return (
      <Screen>
        <Title>Flashcards</Title>
        <Empty
          title={done ? 'All done for now' : 'Nothing to review'}
          body={done ? `You went through ${done} ${done === 1 ? 'card' : 'cards'}. New ones will be ready tomorrow.` : 'Words from your lectures turn into flashcards here.'}
        />
        {done ? <Button kind="secondary" label="Check again" onPress={load} /> : null}
      </Screen>
    )
  }

  return (
    <Screen scroll={false}>
      <Title sub={`${queue.length} left today`}>Flashcards</Title>
      <Pressable
        onPress={() => setFlipped(f => !f)}
        accessibilityRole="button"
        accessibilityLabel={flipped ? `${card.term}. ${card.definition}` : `${card.term}. Tap to see the explanation`}
        style={{
          flex: 1, maxHeight: 460, backgroundColor: c.surface, borderRadius: radius.xl, borderWidth: 1,
          borderColor: flipped ? c.accentBorder : c.border, padding: 24, justifyContent: 'center',
        }}
      >
        <T size={26} weight={700} center tone={flipped ? 'accent' : 'fg'}>{card.term}</T>
        {flipped ? (
          <>
            <T size={17} center style={{ marginTop: 16 }}>{card.definition}</T>
            <View style={{ alignItems: 'center', marginTop: 18 }}><ReadAloud text={`${card.term}. ${card.definition}`} /></View>
          </>
        ) : (
          <T size={14} tone="faint" center style={{ marginTop: 16 }}>Tap to see the explanation</T>
        )}
      </Pressable>

      <View style={{ marginTop: 20, minHeight: 60 }}>
        {flipped ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {GRADES.map(g => (
              <Button key={g.grade} kind={g.grade === 2 ? 'primary' : 'secondary'} label={g.label} accessibilityHint={g.hint}
                onPress={() => grade(g.grade)} disabled={saving} style={{ flex: 1, paddingHorizontal: 6 }} />
            ))}
          </View>
        ) : (
          <Button kind="secondary" label="Show explanation" onPress={() => setFlipped(true)} />
        )}
      </View>
    </Screen>
  )
}
