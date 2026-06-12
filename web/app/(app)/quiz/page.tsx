'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'

interface Term {
  id: string
  term: string
  definition: string
  created_at: string
}

interface MCQuestion {
  type: 'mc'
  termId: string
  term: string
  correctDefinition: string
  options: { text: string; correct: boolean }[]
}

interface SelfQuestion {
  type: 'self'
  termId: string
  term: string
  correctDefinition: string
}

type QuizQuestion = MCQuestion | SelfQuestion

type Mode = 'mc' | 'mixed'
type Scope = 'all' | 'week'
type Phase = 'loading' | 'empty' | 'setup' | 'quiz' | 'done'

function buildQuestions(terms: Term[], count: number, mode: Mode): QuizQuestion[] {
  const shuffled = [...terms].sort(() => Math.random() - 0.5).slice(0, count)

  return shuffled.map((term, i) => {
    const useSelf = mode === 'mixed' && i % 3 === 2

    if (useSelf) {
      return { type: 'self', termId: term.id, term: term.term, correctDefinition: term.definition }
    }

    const others = terms.filter(t => t.id !== term.id)
    const distractors = [...others].sort(() => Math.random() - 0.5).slice(0, 3)
    const options = [
      { text: term.definition, correct: true },
      ...distractors.map(d => ({ text: d.definition, correct: false })),
    ].sort(() => Math.random() - 0.5)

    return { type: 'mc', termId: term.id, term: term.term, correctDefinition: term.definition, options }
  })
}

const COUNT_OPTIONS = [5, 10, 15, 20]

export default function QuizPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromStudy = searchParams.get('from') === 'study'
  const [phase, setPhase] = useState<Phase>('loading')
  const [allTerms, setAllTerms] = useState<Term[]>([])
  const [scope, setScope] = useState<Scope>('all')
  const [mode, setMode] = useState<Mode>('mc')
  const [count, setCount] = useState(10)

  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [wrongTerms, setWrongTerms] = useState<Term[]>([])
  const [answered, setAnswered] = useState(false)

  useEffect(() => {
    ;(async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      capture('quiz_viewed')

      const { data } = await supabase
        .from('terms')
        .select('id, term, definition, created_at')
        .eq('user_id', session.user.id)
        .eq('known', false)
        .order('created_at', { ascending: false })

      const terms = (data ?? []) as Term[]
      setAllTerms(terms)
      setPhase(terms.length < 4 ? 'empty' : 'setup')
    })()
  }, [])

  const filtered = scope === 'week'
    ? allTerms.filter(t => t.created_at >= new Date(Date.now() - 7 * 86400000).toISOString())
    : allTerms

  const canStart = filtered.length >= 4

  function startQuiz(termList?: Term[]) {
    const source = termList ?? filtered
    const qs = buildQuestions(source, Math.min(count, source.length), mode)
    setQuestions(qs)
    setIdx(0)
    setSelected(null)
    setRevealed(false)
    setCorrectCount(0)
    setWrongTerms([])
    setAnswered(false)
    setPhase('quiz')
    capture('quiz_started', { scope, mode, count: qs.length })
  }

  function pickAnswer(text: string) {
    if (answered) return
    const q = questions[idx] as MCQuestion
    const isCorrect = q.options.find(o => o.text === text)?.correct ?? false
    setSelected(text)
    setAnswered(true)
    if (isCorrect) {
      setCorrectCount(c => c + 1)
    } else {
      setWrongTerms(prev => [...prev, { id: q.termId, term: q.term, definition: q.correctDefinition, created_at: '' }])
    }
  }

  function selfGrade(isCorrect: boolean) {
    if (answered) return
    const q = questions[idx]
    setAnswered(true)
    if (isCorrect) {
      setCorrectCount(c => c + 1)
    } else {
      setWrongTerms(prev => [...prev, { id: q.termId, term: q.term, definition: q.correctDefinition, created_at: '' }])
    }
  }

  function next() {
    if (idx + 1 >= questions.length) {
      setPhase('done')
      capture('quiz_completed', {
        correct: correctCount + (answered && !wrongTerms.find(w => w.term === questions[idx].term) ? 0 : 0),
        total: questions.length,
        pct: Math.round((correctCount / questions.length) * 100),
      })
    } else {
      setIdx(i => i + 1)
      setSelected(null)
      setRevealed(false)
      setAnswered(false)
    }
  }

  const pct = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0
  const progress = questions.length > 0 ? (idx / questions.length) * 100 : 0

  // ── Empty ──
  if (phase === 'empty') {
    return (
      <main className="h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col items-center justify-center px-6 nav-bottom-pad overflow-hidden">
        <div className="flex flex-col items-center text-center gap-3 max-w-xs">
          <div className="w-14 h-14 rounded-2xl dark:bg-white/[0.04] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.16] flex items-center justify-center mb-1">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600">
              <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <p className="text-[22px] font-bold">Not enough terms</p>
          <p className="text-gray-700 text-[14px] leading-relaxed">
            You need at least 4 terms in your glossary to start a quiz. Record or import a lecture to get started.
          </p>
          <div className="flex gap-2 mt-2">
            <Link href="/dashboard" className="px-5 py-2.5 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150">
              Record a lecture
            </Link>
            <Link href="/import" className="px-5 py-2.5 rounded-2xl dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.09] border-black/[0.14] text-[14px] font-medium dark:text-gray-300 text-gray-700 active:scale-[0.97] transition-all">
              Import a file
            </Link>
          </div>
        </div>
      </main>
    )
  }

  // ── Loading ──
  if (phase === 'loading') {
    return (
      <main className="h-dvh dark:bg-[#080810] bg-[#EDEAE3] flex flex-col nav-bottom-pad overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 dark:border-white/20 border-black/20 border-t-yellow-500 rounded-full animate-spin" />
        </div>
      </main>
    )
  }

  // ── Setup ──
  if (phase === 'setup') {
    return (
      <main className="h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col overflow-hidden nav-bottom-pad">
        <header className="sm:hidden shrink-0 flex items-center px-4 h-14 border-b dark:border-white/[0.05] border-black/[0.06]">
          {fromStudy ? (
            <button
              onClick={() => router.push('/study')}
              className="flex items-center gap-1 text-[13px] font-medium text-gray-600 hover:dark:text-white hover:text-gray-900 transition-colors -ml-1"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Study
            </button>
          ) : (
            <span className="font-semibold tracking-tight text-[15px]">Quiz</span>
          )}
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="w-full max-w-md mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">

            <div className="animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '0ms' }}>
              <p className="text-[22px] font-bold mb-1">Test yourself</p>
              <p className="text-[13px] text-gray-600">{allTerms.length} terms in your glossary</p>
            </div>

            {/* Scope */}
            <div className="animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '60ms' }}>
              <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-gray-600 mb-2">Which terms</p>
              <div className="grid grid-cols-2 gap-2">
                {([['all', 'All terms', `${allTerms.length}`], ['week', 'This week', `${allTerms.filter(t => t.created_at >= new Date(Date.now() - 7 * 86400000).toISOString()).length}`]] as const).map(([val, label, cnt]) => (
                  <button
                    key={val}
                    onClick={() => setScope(val)}
                    className={`flex flex-col items-start px-4 py-3.5 rounded-2xl border text-left transition-colors active:scale-[0.97] ${
                      scope === val
                        ? 'dark:bg-yellow-500/10 bg-yellow-50 border-yellow-500/40 dark:text-yellow-300 text-yellow-800'
                        : 'dark:bg-white/[0.03] bg-[#FAF9F6] dark:border-white/[0.07] border-black/[0.14] dark:text-white text-gray-900'
                    }`}
                  >
                    <span className="text-[13px] font-semibold">{label}</span>
                    <span className={`text-[11px] mt-0.5 ${scope === val ? 'dark:text-yellow-400/70 text-yellow-700/70' : 'text-gray-600'}`}>{cnt} terms</span>
                  </button>
                ))}
              </div>
              {!canStart && scope === 'week' && (
                <p className="text-[12px] text-orange-500 mt-2">Not enough terms from this week. Switch to All terms.</p>
              )}
            </div>

            {/* Mode */}
            <div className="animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '120ms' }}>
              <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-gray-600 mb-2">Question style</p>
              <div className="grid grid-cols-2 gap-2">
                {([['mc', 'Multiple choice', 'Pick the right definition'], ['mixed', 'Mixed', 'MC + recall questions']] as const).map(([val, label, desc]) => (
                  <button
                    key={val}
                    onClick={() => setMode(val)}
                    className={`flex flex-col items-start px-4 py-3.5 rounded-2xl border text-left transition-colors active:scale-[0.97] ${
                      mode === val
                        ? 'dark:bg-yellow-500/10 bg-yellow-50 border-yellow-500/40 dark:text-yellow-300 text-yellow-800'
                        : 'dark:bg-white/[0.03] bg-[#FAF9F6] dark:border-white/[0.07] border-black/[0.14] dark:text-white text-gray-900'
                    }`}
                  >
                    <span className="text-[13px] font-semibold">{label}</span>
                    <span className={`text-[11px] mt-0.5 ${mode === val ? 'dark:text-yellow-400/70 text-yellow-700/70' : 'text-gray-600'}`}>{desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Count */}
            <div className="animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '180ms' }}>
              <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-gray-600 mb-2">Number of questions</p>
              <div className="flex gap-2">
                {COUNT_OPTIONS.map(n => {
                  const available = Math.min(n, filtered.length)
                  const disabled = filtered.length < 4 || n > filtered.length + 3
                  return (
                    <button
                      key={n}
                      onClick={() => !disabled && setCount(n)}
                      disabled={disabled}
                      className={`flex-1 py-3 rounded-2xl border text-[13px] font-semibold transition-colors active:scale-[0.97] disabled:opacity-30 ${
                        count === n
                          ? 'dark:bg-yellow-500/10 bg-yellow-50 border-yellow-500/40 dark:text-yellow-300 text-yellow-800'
                          : 'dark:bg-white/[0.03] bg-[#FAF9F6] dark:border-white/[0.07] border-black/[0.14] dark:text-white text-gray-900'
                      }`}
                    >
                      {available < n ? available : n}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '240ms' }}>
              <button
                onClick={() => canStart && startQuiz()}
                disabled={!canStart}
                className="w-full py-3.5 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[15px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150 disabled:opacity-40"
              >
                Start quiz
              </button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  // ── Quiz ──
  if (phase === 'quiz') {
    const q = questions[idx]
    const isMC = q.type === 'mc'

    return (
      <main className="h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col overflow-hidden nav-bottom-pad">
        <header className="sm:hidden shrink-0 flex items-center justify-between px-4 h-14 border-b dark:border-white/[0.05] border-black/[0.06]">
          {fromStudy ? (
            <button
              onClick={() => router.push('/study')}
              className="flex items-center gap-1 text-[13px] font-medium text-gray-600 hover:dark:text-white hover:text-gray-900 transition-colors -ml-1"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Study
            </button>
          ) : (
            <span className="font-semibold tracking-tight text-[15px]">Quiz</span>
          )}
          <span className="text-[13px] text-gray-600 tabular-nums">{idx + 1} / {questions.length}</span>
        </header>

        <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-6 pt-4 pb-4">
          {/* Progress */}
          <div className="shrink-0 h-1 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-full mb-4 overflow-hidden">
            <div className="h-full bg-yellow-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>

          {/* Term */}
          <div className="shrink-0 mb-4">
            <p className="text-[11px] font-bold tracking-[0.18em] uppercase text-gray-600 mb-1.5">
              {isMC ? 'What does this mean?' : 'What is the definition?'}
            </p>
            <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.14] rounded-2xl px-5 py-4">
              <p className="text-[22px] font-bold leading-snug">{q.term}</p>
            </div>
          </div>

          {/* MC options */}
          {isMC && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="space-y-2.5">
                {(q as MCQuestion).options.map((opt, i) => {
                  const isSelected = selected === opt.text
                  const showResult = answered
                  const correct = opt.correct
                  let cls = 'dark:bg-white/[0.03] bg-[#FAF9F6] dark:border-white/[0.07] border-black/[0.14] dark:text-white text-gray-900'
                  if (showResult && correct) cls = 'bg-emerald-500/10 border-emerald-500/40 dark:text-emerald-300 text-emerald-800'
                  else if (showResult && isSelected && !correct) cls = 'bg-red-500/10 border-red-500/40 dark:text-red-300 text-red-700'

                  return (
                    <button
                      key={i}
                      onClick={() => pickAnswer(opt.text)}
                      disabled={answered}
                      className={`w-full text-left px-4 py-3.5 rounded-2xl border text-[14px] leading-snug transition-colors active:scale-[0.97] disabled:cursor-default ${cls}`}
                    >
                      <span className="font-semibold mr-2 text-gray-500">{String.fromCharCode(65 + i)}.</span>
                      {opt.text}
                    </button>
                  )
                })}
              </div>

              {answered && (
                <button
                  onClick={next}
                  className="w-full mt-4 py-3.5 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[15px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150 animate-step opacity-0"
                  style={{ animationFillMode: 'forwards' }}
                >
                  {idx + 1 >= questions.length ? 'See results' : 'Next question →'}
                </button>
              )}
            </div>
          )}

          {/* Self-assess */}
          {!isMC && (
            <div className="flex-1 min-h-0 flex flex-col">
              {!revealed ? (
                <div className="flex-1 flex items-center justify-center">
                  <button
                    onClick={() => setRevealed(true)}
                    className="w-full max-w-sm py-4 rounded-2xl text-[15px] font-semibold dark:bg-white/[0.06] bg-[#F3F1EC] border dark:border-white/[0.08] border-black/[0.13] dark:text-white text-gray-900 active:scale-[0.97] transition-colors duration-150"
                  >
                    Reveal definition
                  </button>
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
                  <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.14] rounded-2xl px-5 py-4">
                    <p className="text-[11px] font-bold tracking-[0.18em] uppercase dark:text-yellow-400/70 text-yellow-700/70 mb-2">Definition</p>
                    <p className="text-[15px] leading-relaxed dark:text-white/90 text-gray-800">{q.correctDefinition}</p>
                  </div>

                  {!answered ? (
                    <div className="grid grid-cols-2 gap-2 animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>
                      <button
                        onClick={() => selfGrade(false)}
                        className="py-3.5 rounded-2xl border border-red-500/40 dark:text-red-400 text-red-600 text-[14px] font-semibold bg-red-500/5 hover:bg-red-500/10 active:scale-[0.97] transition-colors duration-150"
                      >
                        Got it wrong
                      </button>
                      <button
                        onClick={() => selfGrade(true)}
                        className="py-3.5 rounded-2xl border border-emerald-500/40 dark:text-emerald-400 text-emerald-700 text-[14px] font-semibold bg-emerald-500/5 hover:bg-emerald-500/10 active:scale-[0.97] transition-colors duration-150"
                      >
                        Got it right
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={next}
                      className="py-3.5 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[15px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150 animate-step opacity-0"
                      style={{ animationFillMode: 'forwards' }}
                    >
                      {idx + 1 >= questions.length ? 'See results' : 'Next question →'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    )
  }

  // ── Done ──
  const wrongCount = wrongTerms.length
  const correctFinal = questions.length - wrongCount
  const pctFinal = Math.round((correctFinal / questions.length) * 100)

  return (
    <main className="h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col overflow-hidden nav-bottom-pad">
      <header className="sm:hidden shrink-0 flex items-center justify-between px-4 h-14 border-b dark:border-white/[0.05] border-black/[0.06]">
        {fromStudy ? (
          <button
            onClick={() => router.push('/study')}
            className="flex items-center gap-1 text-[13px] font-medium text-gray-600 hover:dark:text-white hover:text-gray-900 transition-colors -ml-1"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Study
          </button>
        ) : (
          <span className="font-semibold tracking-tight text-[15px]">Quiz complete</span>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full max-w-md mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">

          {/* Score */}
          <div className="flex flex-col items-center text-center gap-1 animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '0ms' }}>
            <p className="text-[48px] font-bold leading-none dark:text-amber-400 text-amber-600 tabular-nums">{pctFinal}%</p>
            <p className="text-[14px] text-gray-600 mt-1">{correctFinal} of {questions.length} correct</p>
          </div>

          {/* Performance message */}
          <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl px-5 py-4 animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '80ms' }}>
            <p className="text-[14px] dark:text-white/80 text-gray-700 leading-relaxed">
              {pctFinal >= 80
                ? '🎯 Strong session. You have a solid grip on this material.'
                : pctFinal >= 50
                  ? '📈 Good progress. A few terms need more practice — see below.'
                  : '💪 Keep going. These will click with a few more reviews.'}
            </p>
          </div>

          {/* Distribution */}
          <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl px-5 py-4 animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '160ms' }}>
            <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-3">Breakdown</p>
            <div className="space-y-2.5">
              {[
                { label: 'Correct', count: correctFinal, cls: 'bg-emerald-500' },
                { label: 'Wrong', count: wrongCount, cls: 'bg-red-500/60' },
              ].map(({ label, count, cls }) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-[11px] text-gray-600 w-14 shrink-0">{label}</span>
                  <div className="flex-1 h-2 dark:bg-white/[0.05] bg-black/[0.06] rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${cls} transition-all duration-700`} style={{ width: `${questions.length > 0 ? (count / questions.length) * 100 : 0}%` }} />
                  </div>
                  <span className="text-[11px] text-gray-600 w-5 text-right tabular-nums shrink-0">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Wrong terms to review */}
          {wrongTerms.length > 0 && (
            <div className="animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '240ms' }}>
              <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-2">Review these</p>
              <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl overflow-hidden">
                {wrongTerms.map((t, i) => (
                  <div key={t.id} className={`px-4 py-3.5 ${i > 0 ? 'border-t dark:border-white/[0.04] border-black/[0.05]' : ''}`}>
                    <p className="text-[13px] font-semibold dark:text-white/90 text-gray-900">{t.term}</p>
                    <p className="text-[12px] text-gray-600 mt-0.5 leading-relaxed">{t.definition}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTAs */}
          <div className="flex flex-col gap-2 animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '320ms' }}>
            {wrongTerms.length >= 4 && (
              <button
                onClick={() => startQuiz(wrongTerms)}
                className="w-full py-3.5 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150"
              >
                Retake with wrong terms only
              </button>
            )}
            <button
              onClick={() => setPhase('setup')}
              className="w-full py-3 rounded-2xl dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.09] border-black/[0.14] text-[14px] font-medium dark:text-gray-300 text-gray-700 active:scale-[0.97] transition-all"
            >
              New quiz
            </button>
            <Link
              href="/flashcards"
              className="w-full py-3 text-center rounded-2xl dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.09] border-black/[0.14] text-[14px] font-medium dark:text-gray-300 text-gray-700 active:scale-[0.97] transition-all"
            >
              Back to flashcards
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
