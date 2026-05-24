import { useEffect, useRef, useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
  PanResponder, Dimensions, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'

const NEW_CARDS_PER_DAY = 15
const SWIPE_THRESHOLD = 100
const { width: SCREEN_W } = Dimensions.get('window')

interface FlashCard {
  id: string
  term: string
  definition: string
  sm2_interval: number
  sm2_ease: number
  sm2_review_count: number
  isNew: boolean
}

function sm2Update(ease: number, interval: number, grade: 0 | 1 | 2 | 3) {
  const newEase = Math.max(1.3, Math.min(3.0, ease + ([-0.2, -0.15, 0, 0.15] as const)[grade]))
  let newInterval: number
  if (grade === 0) newInterval = 1
  else if (grade === 1) newInterval = Math.max(1, Math.round(interval * 1.2))
  else if (grade === 2) newInterval = Math.max(1, Math.round(interval * ease))
  else newInterval = Math.max(1, Math.round(interval * ease * 1.3))
  return { interval: newInterval, ease: newEase }
}

type Phase = 'loading' | 'empty' | 'review' | 'done'

export default function Flashcards() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [queue, setQueue] = useState<FlashCard[]>([])
  const [current, setCurrent] = useState<FlashCard | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const [total, setTotal] = useState(0)
  const [saving, setSaving] = useState(false)
  const [stuckOnLast, setStuckOnLast] = useState(false)

  // Refs for PanResponder callbacks to avoid stale closures
  const currentRef = useRef<FlashCard | null>(null)
  const queueRef = useRef<FlashCard[]>([])
  const savingRef = useRef(false)
  const stuckOnLastRef = useRef(false)

  currentRef.current = current
  queueRef.current = queue
  savingRef.current = saving
  stuckOnLastRef.current = stuckOnLast

  // Swipe animation
  const pan = useRef(new Animated.ValueXY()).current
  const flipAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const now = new Date().toISOString()
      const [{ data: reviews }, { data: newCards }] = await Promise.all([
        supabase.from('terms').select('id, term, definition, sm2_interval, sm2_ease, sm2_review_count')
          .eq('user_id', user.id).eq('known', false).gt('sm2_review_count', 0).lte('sm2_due_at', now)
          .order('sm2_due_at', { ascending: true }),
        supabase.from('terms').select('id, term, definition, sm2_interval, sm2_ease, sm2_review_count')
          .eq('user_id', user.id).eq('known', false).eq('sm2_review_count', 0)
          .order('created_at', { ascending: true }).limit(NEW_CARDS_PER_DAY),
      ])
      const due = (reviews ?? []).map(c => ({ ...c, isNew: false })) as FlashCard[]
      const fresh = (newCards ?? []).map(c => ({ ...c, isNew: true })) as FlashCard[]
      const cards = [...due, ...fresh]
      if (!cards.length) { setPhase('empty'); return }
      setTotal(cards.length)
      setQueue(cards.slice(1))
      setCurrent(cards[0])
      setPhase('review')
    })()
  }, [])

  const handleGrade = async (grade: 0 | 1 | 2 | 3) => {
    const card = currentRef.current
    if (!card || savingRef.current) return
    setSaving(true)

    const { interval, ease } = sm2Update(card.sm2_ease ?? 2.5, card.sm2_interval ?? 1, grade)
    const dueAt = new Date(Date.now() + interval * 86400000).toISOString()
    await supabase.from('terms').update({
      sm2_interval: interval, sm2_ease: ease,
      sm2_due_at: dueAt, sm2_review_count: (card.sm2_review_count ?? 0) + 1,
    }).eq('id', card.id)

    flipAnim.setValue(0)
    setFlipped(false)
    setSaving(false)

    const q = queueRef.current

    if (grade === 0) {
      if (q.length === 0) { setCurrent(card); setStuckOnLast(true) }
      else {
        const [next, ...rest] = q
        setQueue([...rest, { ...card, isNew: false }])
        setCurrent(next)
        setStuckOnLast(false)
      }
      return
    }

    setStuckOnLast(false)
    setReviewed(r => r + 1)
    if (q.length === 0) { setPhase('done') }
    else { setCurrent(q[0]); setQueue(q.slice(1)) }
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => !savingRef.current && Math.abs(g.dx) > 8,
      onPanResponderMove: Animated.event([null, { dx: pan.x }], { useNativeDriver: false }),
      onPanResponderRelease: (_, g) => {
        if (g.dx > SWIPE_THRESHOLD) {
          Animated.timing(pan, { toValue: { x: SCREEN_W, y: g.dy }, duration: 200, useNativeDriver: false }).start(() => {
            pan.setValue({ x: 0, y: 0 }); handleGrade(3)
          })
        } else if (g.dx < -SWIPE_THRESHOLD) {
          Animated.timing(pan, { toValue: { x: -SCREEN_W, y: g.dy }, duration: 200, useNativeDriver: false }).start(() => {
            pan.setValue({ x: 0, y: 0 }); handleGrade(0)
          })
        } else {
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start()
        }
      },
    })
  ).current

  const handleFlip = () => {
    if (flipped) return
    Animated.spring(flipAnim, { toValue: 1, useNativeDriver: true }).start()
    setFlipped(true)
  }

  const cardRotate = pan.x.interpolate({ inputRange: [-SCREEN_W, 0, SCREEN_W], outputRange: ['-12deg', '0deg', '12deg'] })
  const againOpacity = pan.x.interpolate({ inputRange: [-SWIPE_THRESHOLD, 0], outputRange: [1, 0], extrapolate: 'clamp' })
  const easyOpacity = pan.x.interpolate({ inputRange: [0, SWIPE_THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' })

  const frontRotateY = flipAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] })
  const backRotateY = flipAnim.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] })

  if (phase === 'loading') return <View style={[s.container, s.center]}><ActivityIndicator color="#7c3aed" /></View>

  if (phase === 'empty') return (
    <SafeAreaView style={[s.container, s.center]}>
      <Text style={s.bigEmoji}>🎉</Text>
      <Text style={s.title}>All caught up</Text>
      <Text style={s.subtitle}>No cards due. Record a lecture to add terms.</Text>
    </SafeAreaView>
  )

  if (phase === 'done') return (
    <SafeAreaView style={[s.container, s.center]}>
      <Text style={s.bigEmoji}>✅</Text>
      <Text style={s.title}>Session complete</Text>
      <Text style={s.subtitle}>You reviewed {reviewed} card{reviewed !== 1 ? 's' : ''}.</Text>
    </SafeAreaView>
  )

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Flashcards</Text>
        <Text style={s.counter}>{reviewed}/{total}</Text>
      </View>

      {/* Progress bar */}
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${total > 0 ? Math.round((reviewed / total) * 100) : 0}%` }]} />
      </View>

      {/* Swipe hint labels */}
      <View style={s.hintRow}>
        <Animated.View style={[s.hintBadge, s.hintAgain, { opacity: againOpacity }]}>
          <Text style={s.hintAgainText}>Again</Text>
        </Animated.View>
        <Animated.View style={[s.hintBadge, s.hintEasy, { opacity: easyOpacity }]}>
          <Text style={s.hintEasyText}>Easy</Text>
        </Animated.View>
      </View>

      {/* Card */}
      <View style={s.cardArea}>
        {current && (
          <Animated.View
            style={[s.cardWrapper, { transform: [{ translateX: pan.x }, { rotate: cardRotate }] }]}
            {...(!flipped ? panResponder.panHandlers : {})}
          >
            <TouchableOpacity activeOpacity={1} onPress={handleFlip} style={{ flex: 1 }}>
              {/* Front */}
              <Animated.View style={[s.card, s.cardFront, { transform: [{ rotateY: frontRotateY }] }]}>
                <Text style={s.cardLabel}>{current.isNew ? 'New' : 'Review'}</Text>
                <Text style={s.cardTerm}>{current.term}</Text>
                {!flipped && <Text style={s.tapHint}>Tap to reveal · swipe to grade</Text>}
              </Animated.View>

              {/* Back */}
              <Animated.View style={[s.card, s.cardBack, { transform: [{ rotateY: backRotateY }] }]}>
                <Text style={s.defLabel}>Definition</Text>
                <Text style={s.cardDef}>{current.definition}</Text>
              </Animated.View>
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>

      {/* Grade buttons (shown after flip) */}
      {flipped && (
        <View style={s.gradeRow}>
          {([
            { grade: 0, label: 'Again', color: '#ef4444' },
            { grade: 1, label: 'Hard', color: '#f97316' },
            { grade: 2, label: 'Good', color: '#10b981' },
            { grade: 3, label: 'Easy', color: '#8b5cf6' },
          ] as const).map(({ grade, label, color }) => (
            <TouchableOpacity
              key={grade}
              onPress={() => handleGrade(grade)}
              disabled={saving}
              style={[s.gradeBtn, { borderColor: color + '60' }]}
              activeOpacity={0.7}
            >
              <Text style={[s.gradeBtnText, { color }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {stuckOnLast && (
        <TouchableOpacity onPress={() => setPhase('done')} style={s.doneLink}>
          <Text style={s.doneLinkText}>Done for today →</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080810' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  bigEmoji: { fontSize: 52, marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: 15, color: '#6b7280', textAlign: 'center', paddingHorizontal: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  counter: { fontSize: 13, color: '#4b5563' },
  progressTrack: { height: 3, backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 20, borderRadius: 2, overflow: 'hidden', marginBottom: 16 },
  progressFill: { height: '100%', backgroundColor: '#7c3aed', borderRadius: 2 },
  hintRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, marginBottom: 8 },
  hintBadge: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 100, borderWidth: 1.5 },
  hintAgain: { borderColor: 'rgba(239,68,68,0.5)', backgroundColor: 'rgba(239,68,68,0.1)' },
  hintEasy: { borderColor: 'rgba(139,92,246,0.5)', backgroundColor: 'rgba(139,92,246,0.1)' },
  hintAgainText: { color: '#ef4444', fontWeight: '600', fontSize: 13 },
  hintEasyText: { color: '#8b5cf6', fontWeight: '600', fontSize: 13 },
  cardArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  cardWrapper: { width: '100%', height: 260 },
  card: {
    position: 'absolute', inset: 0,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    padding: 28, backfaceVisibility: 'hidden',
  },
  cardFront: {},
  cardBack: { borderColor: 'rgba(139,92,246,0.25)' },
  cardLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 2, color: 'rgba(139,92,246,0.6)', textTransform: 'uppercase', marginBottom: 16 },
  cardTerm: { fontSize: 26, fontWeight: '700', color: '#fff', textAlign: 'center', lineHeight: 32 },
  tapHint: { fontSize: 12, color: '#374151', marginTop: 20 },
  defLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 2, color: 'rgba(139,92,246,0.7)', textTransform: 'uppercase', marginBottom: 16 },
  cardDef: { fontSize: 16, color: '#d1d5db', textAlign: 'center', lineHeight: 24 },
  gradeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 16 },
  gradeBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 18,
    borderWidth: 1, alignItems: 'center', backgroundColor: 'transparent',
  },
  gradeBtnText: { fontSize: 13, fontWeight: '600' },
  doneLink: { alignItems: 'center', paddingBottom: 8 },
  doneLinkText: { fontSize: 13, color: '#4b5563' },
})
