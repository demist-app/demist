// One lecture: summary, the moments marked "I'm lost" (with the words around
// them, as web/components/LostMoments.tsx), the words explained, and the
// transcript where consent allowed it to be saved.
import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { usePrefs } from '../../lib/prefs'
import { reportWriteFailure } from '../../lib/analytics'
import { lectureTitle, minutes, clockFromMs, paragraphs } from '../../lib/format'
import { radius } from '../../lib/theme'
import { Button, Card, Loading, ReadAloud, Screen, SectionLabel, T, Input } from '../../components/ui'
import { BackIcon } from '../../components/icons'

interface Lecture {
  id: string; name: string | null; subject: string | null; started_at: string; ended_at: string | null
  synopsis: string | null; transcript: string | null; capture_mode: string | null
}
interface Term { id: string; term: string; definition: string; created_at: string }
interface Mark { at_ms: number; transcript_offset: number }

const BEFORE_CHARS = 420
const AFTER_CHARS = 260
const TERM_WINDOW_BEFORE_MS = 3 * 60_000
const TERM_WINDOW_AFTER_MS = 2 * 60_000

function excerpt(text: string, offset: number): string | null {
  if (!text) return null
  const at = Math.min(offset, text.length)
  let start = Math.max(0, at - BEFORE_CHARS)
  let end = Math.min(text.length, at + AFTER_CHARS)
  if (start > 0) { const sp = text.indexOf(' ', start); if (sp !== -1 && sp < at) start = sp + 1 }
  if (end < text.length) { const sp = text.lastIndexOf(' ', end); if (sp > at) end = sp }
  const body = text.slice(start, end).trim()
  if (!body) return null
  return `${start > 0 ? '… ' : ''}${body}${end < text.length ? ' …' : ''}`
}

export default function LectureScreen() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>()
  const { c, font, size } = usePrefs()
  const [lecture, setLecture] = useState<Lecture | null>(null)
  const [terms, setTerms] = useState<Term[]>([])
  const [marks, setMarks] = useState<Mark[]>([])
  const [showTranscript, setShowTranscript] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [missing, setMissing] = useState(false)

  const load = useCallback(async () => {
    const [{ data: s }, { data: t }, { data: m }] = await Promise.all([
      supabase.from('sessions').select('id, name, subject, started_at, ended_at, synopsis, transcript, capture_mode').eq('id', id).maybeSingle(),
      supabase.from('terms').select('id, term, definition, created_at').eq('session_id', id).order('created_at'),
      supabase.from('session_marks').select('at_ms, transcript_offset').eq('session_id', id).order('at_ms'),
    ])
    if (!s) { setMissing(true); return }
    setLecture(s as Lecture)
    setTerms((t as Term[]) ?? [])
    setMarks((m as Mark[]) ?? [])
  }, [id])

  useEffect(() => { void load() }, [load])

  // The summary is written a few seconds after a recording stops. Look again
  // a couple of times rather than showing an empty space forever.
  useEffect(() => {
    if (!fresh || lecture?.synopsis || !terms.length) return
    const t = setTimeout(() => { void load() }, 6000)
    return () => clearTimeout(t)
  }, [fresh, lecture?.synopsis, terms.length, load])

  if (missing) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Header />
        <T tone="muted" style={{ marginTop: 24 }}>This lecture could not be found. It may have been deleted.</T>
      </Screen>
    )
  }
  if (!lecture) return <Loading />

  const t0 = new Date(lecture.started_at).getTime()
  const mins = minutes(lecture)
  const paras = lecture.transcript ? paragraphs(lecture.transcript) : []

  const saveName = async () => {
    const value = name.trim() || null
    const { error } = await supabase.from('sessions').update({ name: value }).eq('id', lecture.id)
    if (!reportWriteFailure('session.name', error)) setLecture({ ...lecture, name: value })
    setRenaming(false)
  }

  const remove = () => {
    Alert.alert('Delete this lecture?', 'Its transcript, summary and words will be deleted. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('sessions').delete().eq('id', lecture.id)
        if (!reportWriteFailure('session.delete', error)) router.back()
      } },
    ])
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <Header />

      {renaming ? (
        <View style={{ gap: 10, marginTop: 8 }}>
          <Input value={name} onChangeText={setName} autoFocus placeholder={lectureTitle(lecture)} placeholderTextColor={c.fgFaint}
            onSubmitEditing={saveName} returnKeyType="done" accessibilityLabel="Lecture name"
            style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 14, color: c.fg, fontFamily: font(600), fontSize: size(18) }} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="Save" onPress={saveName} style={{ flex: 1, minHeight: 44 }} />
            <Button kind="quiet" label="Cancel" onPress={() => setRenaming(false)} style={{ minHeight: 44 }} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 8 }}>
          <T size={26} weight={700} style={{ flex: 1 }}>{lectureTitle(lecture)}</T>
          <Pressable onPress={() => { setName(lecture.name ?? ''); setRenaming(true) }} hitSlop={10} accessibilityRole="button"
            accessibilityLabel="Rename this lecture" style={{ paddingTop: 8 }}>
            <T size={14} weight={600} tone="accent">Rename</T>
          </Pressable>
        </View>
      )}
      <T size={13} tone="faint" style={{ marginTop: 4 }}>
        {[new Date(lecture.started_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
          mins ? `${mins} min` : null, terms.length ? `${terms.length} new ${terms.length === 1 ? 'word' : 'words'}` : null].filter(Boolean).join(' · ')}
      </T>

      <SectionLabel>Summary</SectionLabel>
      {lecture.synopsis ? (
        <Card>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <T style={{ flex: 1 }}>{lecture.synopsis}</T>
            <ReadAloud text={lecture.synopsis} label="Read the summary aloud" />
          </View>
          <T size={12} tone="faint" style={{ marginTop: 10 }}>Written automatically. Check anything important against your course materials.</T>
        </Card>
      ) : (
        <T tone="muted">
          {fresh && terms.length ? 'Your summary is being written. It will appear here in a moment.'
            : terms.length ? 'No summary for this lecture. Summaries need permission to keep the recording, which you can add in Settings.'
            : 'No new words came up in this lecture, so there is nothing to summarise.'}
        </T>
      )}

      {marks.length > 0 && (
        <>
          <SectionLabel>{marks.length === 1 ? 'The moment you marked' : `Moments you marked (${marks.length})`}</SectionLabel>
          <View style={{ gap: 10 }}>
            {marks.map((m, i) => {
              const text = lecture.transcript ? excerpt(lecture.transcript, m.transcript_offset) : null
              const near = terms.filter(t => {
                const d = new Date(t.created_at).getTime() - (t0 + m.at_ms)
                return d >= -TERM_WINDOW_BEFORE_MS && d <= TERM_WINDOW_AFTER_MS
              }).slice(0, 4)
              return (
                <Card key={i} style={{ borderColor: c.accentBorder, backgroundColor: c.accentSoft }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <T size={13} weight={700} tone="accent">At {clockFromMs(m.at_ms)}</T>
                    {text ? <ReadAloud text={text.replace(/…/g, '')} label={`Read the moment at ${clockFromMs(m.at_ms)} aloud`} /> : null}
                  </View>
                  {text ? <T size={15}>{text}</T> : <T size={13} tone="muted">The transcript for this lecture wasn’t saved, so only the time is shown.</T>}
                  {near.length > 0 && (
                    <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border, gap: 6 }}>
                      <T size={12} tone="faint">Words explained around then</T>
                      {near.map(t => <T key={t.id} size={14}><T size={14} weight={700}>{t.term}</T>: {t.definition}</T>)}
                    </View>
                  )}
                </Card>
              )
            })}
          </View>
        </>
      )}

      {terms.length > 0 && (
        <>
          <SectionLabel>Words from this lecture</SectionLabel>
          <View style={{ gap: 8 }}>
            {terms.map(t => (
              <Card key={t.id} style={{ padding: 14 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <T weight={700}>{t.term}</T>
                    <T size={15} tone="muted" style={{ marginTop: 2 }}>{t.definition}</T>
                  </View>
                  <ReadAloud text={`${t.term}. ${t.definition}`} />
                </View>
              </Card>
            ))}
          </View>
        </>
      )}

      <SectionLabel>Transcript</SectionLabel>
      {lecture.transcript ? (
        <>
          <Card style={{ gap: 14 }}>
            {(showTranscript ? paras : paras.slice(0, 2)).map((p, i) => <T key={i} size={15} selectable>{p}</T>)}
          </Card>
          {paras.length > 2 ? (
            <Button kind="quiet" label={showTranscript ? 'Show less' : 'Show the whole transcript'} onPress={() => setShowTranscript(s => !s)} />
          ) : null}
        </>
      ) : (
        <T tone="muted">
          Not saved. Transcripts are kept when your lecturer has said yes to recording this module, or when you have told us about a support need. You can add either in Settings.
        </T>
      )}

      <Button kind="danger" label="Delete this lecture" onPress={remove} style={{ marginTop: 32 }} />
    </Screen>
  )
}

function Header() {
  const { c } = usePrefs()
  return (
    <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 8, alignSelf: 'flex-start' }}>
      <BackIcon color={c.accent} />
      <T weight={600} tone="accent">Back</T>
    </Pressable>
  )
}
