// A lecture's notes on the iPhone, as web/components/LectureNotes.tsx: shown
// when they exist, offered when they could be made, nothing when there is no
// transcript to make them from. Only points the transcript supports are shown
// (lib/shared/lectureNotes.ts), plus the lecturer's own words on dates and
// exams, which are worked out on the phone and so are free.
//
// Out of free notes, it says when more arrive and offers Pro, which is sold
// through Apple in-app purchase (app/pro.tsx). Never a link to the web.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Share, View } from 'react-native'
import { router } from 'expo-router'
import { usePrefs } from '../lib/prefs'
import { capture } from '../lib/analytics'
import { freeNotesLeft, makeNotes, notesState, subscribeNotes, type NotesFailure } from '../lib/notes'
import { groundedNotes, notesAsText, parseNotes, reminders, NOTES_MIN_CHARS } from '../lib/shared/lectureNotes'
import { LIMITS } from '../lib/shared/entitlementRules'
import { Button, Card, ReadAloud, SectionLabel, T } from './ui'

const FAILED: Record<Exclude<NotesFailure, 'free_limit'>, string> = {
  too_short: 'This lecture is too short to make notes from.',
  busy: 'Too many notes at once. Try again in a few minutes.',
  failed: 'The notes could not be made. Try again.',
}

const nextMonth = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}

export function LectureNotes({ sessionId, title, transcript, saved, language }: {
  sessionId: string; title: string; transcript: string | null; saved: string | null; language?: string | null
}) {
  const { c } = usePrefs()
  const [left, setLeft] = useState<number | null | undefined>(undefined)   // null: unlimited
  const state = useSyncExternalStore(subscribeNotes, () => notesState(sessionId))

  useEffect(() => {
    let cancelled = false
    freeNotesLeft().then(n => { if (!cancelled) setLeft(n) }).catch(() => { if (!cancelled) setLeft(null) })
    return () => { cancelled = true }
  }, [sessionId, state.status])

  const raw = state.status === 'done' ? state.raw : saved
  const notes = useMemo(() => parseNotes(raw), [raw])
  const sections = useMemo(() => (notes ? groundedNotes(notes, transcript) : []), [notes, transcript])
  const remind = useMemo(() => reminders(transcript), [transcript])

  const chars = (transcript ?? '').trim().length
  if (!notes && chars < NOTES_MIN_CHARS) return null

  const reminderBox = remind.length > 0 ? (
    <View style={{ marginTop: 14, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.accentBorder, backgroundColor: c.accentSoft, gap: 4 }}>
      <T size={13} weight={600} tone="accent">Dates and reminders, in the lecturer’s words</T>
      {remind.map((r, i) => <T key={i} size={14}>•  {r}</T>)}
    </View>
  ) : null

  if (notes && (sections.length > 0 || remind.length > 0)) {
    const text = notesAsText(title, sections, remind)
    const share = async () => {
      try {
        const r = await Share.share({ message: text, title })
        if (r.action === Share.sharedAction) capture('lecture_notes_copied', { platform: 'ios', via: 'share' })
      } catch { /* the notes are still on screen */ }
    }
    return (
      <>
        <SectionLabel>Notes</SectionLabel>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 14, marginBottom: 4 }}>
            <ReadAloud text={text} label="Read these notes aloud" />
            <Button kind="quiet" label="Share" onPress={share} style={{ minHeight: 36, paddingHorizontal: 8 }} />
          </View>
          <View style={{ gap: 16 }}>
            {sections.map((s, i) => (
              <View key={i} style={{ gap: 6 }}>
                {s.heading ? <T weight={700}>{s.heading}</T> : null}
                {s.points.map((p, j) => (
                  <View key={j} style={{ flexDirection: 'row', gap: 8 }}>
                    <T tone="accent">•</T>
                    <T size={15} selectable style={{ flex: 1 }}>{p}</T>
                  </View>
                ))}
              </View>
            ))}
          </View>
          {reminderBox}
          <T size={12} tone="faint" style={{ marginTop: 12 }}>Made automatically from the transcript. Check anything important against your lecture.</T>
        </Card>
      </>
    )
  }

  const limit = LIMITS.free.notesPerMonth ?? 3
  const outOfFree = left === 0 || (state.status === 'failed' && state.reason === 'free_limit')
  const working = state.status === 'working'
  const note =
    working ? 'Reading your lecture. This takes a few seconds, and you can leave this screen.'
      : state.status === 'failed' && state.reason !== 'free_limit' ? FAILED[state.reason]
        : outOfFree ? `You have used this month’s ${limit} free notes. More arrive on ${nextMonth()}.`
          : 'Written from your saved transcript, which is sent to our server to write them.'

  return (
    <>
      <SectionLabel>Notes</SectionLabel>
      <Card>
        <T weight={600}>
          Full lecture notes{typeof left === 'number' && left > 0 ? <T tone="muted"> · {left} of {limit} free left this month</T> : null}
        </T>
        <T size={14} tone="muted" style={{ marginTop: 4 }}>{note}</T>
        {!outOfFree && (
          <Button label={working ? 'Making notes…' : 'Make notes'} loading={working} disabled={left === undefined}
            onPress={() => { void makeNotes({ sessionId, transcriptChars: chars, language }) }} style={{ marginTop: 12, minHeight: 48 }} />
        )}
        {outOfFree && (
          <Button kind="secondary" label="Notes for every lecture with Pro" onPress={() => { capture('pro_cta_tapped', { from: 'notes_limit' }); router.push('/pro') }} style={{ marginTop: 12, minHeight: 48 }} />
        )}
        {reminderBox}
      </Card>
    </>
  )
}
