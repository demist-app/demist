'use client'

// Master notes: every lecture of one module, combined into one page.
//
// Asked for 2026-10-24 ("you've got individual notes, can they be combined
// into master notes?"). The personal version comes first; a shared version
// for everyone on a module is planned on top of it (the community portal).
//
// One module = the sessions whose subject matches, ignoring case and spacing,
// which is how History and recording consent already group lectures. The
// page combines, in this order:
//   - what the module has covered: each lecture's summary, oldest first
//   - words to know: one glossary across all of them, the same concept
//     counted once (termSimilarity's collidesWith, the dedupe live cards use)
//   - moments marked "I'm lost", with the words around each
// and offers it as plain text to copy, or to print.
import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useEntitlements } from '@/lib/entitlements'
import { capture } from '@/lib/analytics'
import { collidesWith } from '@/lib/termSimilarity'
import { excerpt } from '@/components/LostMoments'
import { ReadAloudButton } from '@/components/ReadAloudButton'

interface Lecture {
  id: string
  name: string | null
  subject: string | null
  started_at: string
  synopsis: string | null
  transcript: string | null
}
interface TermRow { term: string; definition: string; session_id: string; created_at: string; known: boolean | null }
interface MarkRow { session_id: string; at_ms: number; transcript_offset: number }

interface MasterTerm { term: string; definition: string; lectures: Set<string>; known: boolean }

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const fmtClock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}
const lectureTitle = (l: Lecture) => l.name || fmtDate(l.started_at)

function MasterNotes() {
  const params = useSearchParams()
  const moduleParam = params.get('module') ?? ''
  const { limits, loaded: entitlementsLoaded } = useEntitlements()
  const [lectures, setLectures] = useState<Lecture[] | null>(null)
  const [terms, setTerms] = useState<TermRow[]>([])
  const [marks, setMarks] = useState<MarkRow[]>([])
  const [olderHidden, setOlderHidden] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!entitlementsLoaded) return
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user.id
      if (!uid) return
      // Subjects are free text, so match them here rather than with an exact
      // .eq(): "Cell Biology" and "cell biology " are the same module.
      const { data } = await supabase.from('sessions')
        .select('id, name, subject, started_at, synopsis, transcript')
        .eq('user_id', uid)
        .order('started_at', { ascending: true })
      const all = ((data ?? []) as Lecture[]).filter(l => norm(l.subject) === norm(moduleParam))
      const cutoff = limits.historyDays != null ? Date.now() - limits.historyDays * 86_400_000 : null
      const visible = cutoff ? all.filter(l => new Date(l.started_at).getTime() >= cutoff) : all
      if (cancelled) return
      setOlderHidden(all.length - visible.length)
      setLectures(visible)
      const ids = visible.map(l => l.id)
      if (!ids.length) return
      const [{ data: t }, { data: m }] = await Promise.all([
        supabase.from('terms').select('term, definition, session_id, created_at, known').in('session_id', ids).order('created_at'),
        // Absent until migration 042 on older databases; an error just means no marks.
        supabase.from('session_marks').select('session_id, at_ms, transcript_offset').in('session_id', ids).order('at_ms'),
      ])
      if (cancelled) return
      setTerms((t ?? []) as TermRow[])
      setMarks((m ?? []) as MarkRow[])
      capture('master_notes_viewed', { lectures: visible.length, terms: (t ?? []).length, marks: (m ?? []).length })
    })()
    return () => { cancelled = true }
  }, [moduleParam, entitlementsLoaded, limits.historyDays])

  // One entry per concept across every lecture: "cell membrane" in week 1 and
  // "cell membranes" in week 4 are the same word to learn.
  const glossary = useMemo(() => {
    const out: MasterTerm[] = []
    for (const t of terms) {
      const clash = collidesWith(t.term, out.map(o => o.term))
      const existing = clash ? out.find(o => o.term === clash) : undefined
      if (existing) {
        existing.lectures.add(t.session_id)
        existing.known = existing.known && !!t.known
      } else {
        out.push({ term: t.term, definition: t.definition, lectures: new Set([t.session_id]), known: !!t.known })
      }
    }
    return out.sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }))
  }, [terms])

  const byId = useMemo(() => new Map((lectures ?? []).map(l => [l.id, l])), [lectures])
  const moments = useMemo(() => marks.map(m => {
    const l = byId.get(m.session_id)
    return { lecture: l, atMs: m.at_ms, text: l?.transcript ? excerpt(l.transcript, m.transcript_offset) : null }
  }).filter(x => x.lecture), [marks, byId])

  const moduleName = lectures?.[0]?.subject?.trim() || moduleParam

  const asText = () => {
    const lines: string[] = [`${moduleName}: master notes`, '']
    lines.push('WHAT THIS MODULE HAS COVERED', '')
    for (const l of lectures ?? []) lines.push(`${lectureTitle(l)} (${fmtDate(l.started_at)})`, l.synopsis || 'No summary for this lecture.', '')
    lines.push('WORDS TO KNOW', '')
    for (const g of glossary) lines.push(`${g.term}: ${g.definition}`)
    if (moments.length) {
      lines.push('', 'MOMENTS YOU MARKED', '')
      for (const m of moments) lines.push(`${lectureTitle(m.lecture!)} at ${fmtClock(m.atMs)}`, m.text ?? '(No transcript was saved for this lecture.)', '')
    }
    return lines.join('\n').trim() + '\n'
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      capture('master_notes_copied', { terms: glossary.length })
    } catch { /* clipboard blocked: the print option still works */ }
  }

  const card = 'dark:bg-white/[0.03] bg-[#FFFFFF] border dark:border-white/[0.06] border-black/[0.12] rounded-2xl'
  const sectionLabel = 'text-[11px] font-bold tracking-[0.15em] uppercase text-gray-600 mb-3'

  return (
    <main className="min-h-dvh dark:bg-[#110B1C] bg-[#F3F0F8] dark:text-white text-gray-900 flex flex-col nav-bottom-pad">
      <header className="relative z-10 shrink-0 flex items-center justify-between px-4 sm:px-6 h-14 border-b dark:border-white/[0.05] border-black/[0.06] print:hidden">
        <Link href="/history" className="text-[13px] text-gray-600 hover:dark:text-white/70 hover:text-gray-900 transition-colors">
          ← History
        </Link>
        {lectures && lectures.length > 0 && (
          <div className="flex items-center gap-2">
            <button onClick={copy} className="text-[13px] text-brand-700 dark:text-brand-300 hover:opacity-80 transition-opacity px-2 py-1">
              {copied ? 'Copied' : 'Copy as text'}
            </button>
            <button onClick={() => { capture('master_notes_printed', {}); window.print() }} className="text-[13px] text-gray-600 hover:dark:text-white/70 hover:text-gray-900 transition-colors px-2 py-1">
              Print
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-6 animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>
          {!lectures && (
            <div className="animate-pulse space-y-3">
              <div className="h-8 w-56 dark:bg-white/[0.07] bg-[#ECE8F4] rounded-xl" />
              <div className="h-3.5 w-40 dark:bg-white/[0.05] bg-[#FFFFFF] rounded-full" />
            </div>
          )}

          {lectures && lectures.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-[17px] font-semibold mb-1">No lectures for this module yet</p>
              <p className="text-[14px] dark:text-white/60 text-gray-600">
                {olderHidden > 0
                  ? `Free keeps the last ${limits.historyDays} days, and this module's lectures are older. Nothing has been deleted.`
                  : 'Record a lecture with this module name and its notes will collect here.'}
              </p>
            </div>
          )}

          {lectures && lectures.length > 0 && (
            <>
              <h1 className="text-[30px] font-bold tracking-tight leading-tight">{moduleName}</h1>
              <p className="text-[13px] dark:text-white/60 text-gray-600 mt-1">
                Master notes from {lectures.length} lecture{lectures.length !== 1 ? 's' : ''}, {fmtDate(lectures[0].started_at)} to {fmtDate(lectures[lectures.length - 1].started_at)}
                {' · '}{glossary.length} word{glossary.length !== 1 ? 's' : ''}
                {moments.length > 0 ? ` · ${moments.length} marked moment${moments.length !== 1 ? 's' : ''}` : ''}
              </p>
              {olderHidden > 0 && (
                <p className="text-[12px] text-gray-500 mt-2">
                  {olderHidden} older lecture{olderHidden !== 1 ? 's are' : ' is'} not included: free keeps the last {limits.historyDays} days. Nothing has been deleted.
                </p>
              )}

              <section className="mt-8">
                <p className={sectionLabel}>What this module has covered</p>
                <ol className="space-y-3">
                  {lectures.map((l, i) => (
                    <li key={l.id} className={`${card} px-4 py-3`}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[14px] font-semibold">
                          <span className="text-gray-500 font-medium mr-2">{i + 1}.</span>{lectureTitle(l)}
                        </p>
                        <span className="shrink-0 text-[12px] text-gray-500">{fmtDate(l.started_at)}</span>
                      </div>
                      <div className="flex items-start gap-2 mt-1.5">
                        <p className="flex-1 text-[calc(0.875rem*var(--df-scale))] leading-relaxed dark:text-white/75 text-gray-800">
                          {l.synopsis || <span className="text-gray-500">No summary for this lecture.</span>}
                        </p>
                        {l.synopsis && <ReadAloudButton text={l.synopsis} label="Read this summary aloud" className="print:hidden" />}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="mt-8">
                <p className={sectionLabel}>Words to know ({glossary.length})</p>
                {glossary.length === 0 ? (
                  <p className="text-[14px] text-gray-500">No words were explained in these lectures.</p>
                ) : (
                  <div className={`${card} divide-y dark:divide-white/[0.05] divide-black/[0.06]`}>
                    {glossary.map(g => (
                      <div key={g.term} className="px-4 py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold">
                            {g.term}
                            {g.lectures.size > 1 && (
                              <span className="ml-2 text-[11px] font-medium text-gray-500">in {g.lectures.size} lectures</span>
                            )}
                            {g.known && <span className="ml-2 text-[11px] font-medium text-gray-500">known</span>}
                          </p>
                          <p className="text-[calc(0.8125rem*var(--df-scale))] leading-relaxed dark:text-white/70 text-gray-700 mt-0.5">{g.definition}</p>
                        </div>
                        <ReadAloudButton text={`${g.term}. ${g.definition}`} label={`Read ${g.term} aloud`} className="print:hidden" />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {moments.length > 0 && (
                <section className="mt-8">
                  <p className={sectionLabel}>{moments.length === 1 ? 'The moment you marked' : `Moments you marked (${moments.length})`}</p>
                  <div className="space-y-3">
                    {moments.map((m, i) => (
                      <div key={i} className="rounded-xl border dark:border-brand-500/20 border-brand-200 dark:bg-brand-500/[0.05] bg-brand-50/60 px-4 py-3">
                        <p className="text-[12px] font-semibold dark:text-brand-300 text-brand-700 mb-1.5">
                          {lectureTitle(m.lecture!)}, at {fmtClock(m.atMs)}
                        </p>
                        {m.text
                          ? <p className="text-[calc(0.8125rem*var(--df-scale))] leading-relaxed dark:text-white/75 text-gray-800">{m.text}</p>
                          : <p className="text-[12px] dark:text-white/60 text-gray-600">The transcript for this lecture wasn&apos;t saved, so only the time is shown.</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <p className="text-[12px] text-gray-500 mt-8">
                Summaries and explanations are written automatically and are occasionally imperfect. Check anything important against your course materials.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

export default function MasterNotesPage() {
  // useSearchParams needs a Suspense boundary in a client page.
  return (
    <Suspense fallback={null}>
      <MasterNotes />
    </Suspense>
  )
}
