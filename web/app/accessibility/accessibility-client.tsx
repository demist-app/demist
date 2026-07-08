'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'

const useCases = [
  {
    title: 'Auditory processing and ADHD',
    body: 'Live definitions appear the moment an unfamiliar term is said, so a lapse in concentration doesn’t mean losing the thread of the lecture.',
  },
  {
    title: 'Dyslexia and specific learning difficulties',
    body: 'Students don’t need to write while listening. Demist builds the notes, and flashcards turn them into revision material automatically.',
  },
  {
    title: 'Anxiety and social communication needs',
    body: 'No need to interrupt a lecture or approach a lecturer afterwards to ask what a term meant. The explanation is already there.',
  },
  {
    title: 'English as an additional language',
    body: 'Technical vocabulary and fast delivery are the two biggest barriers for non-native speakers. Demist addresses both without singling anyone out.',
  },
]

export function AccessibilityClient() {
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      if (data.session) setAuthed(true)
    })
  }, [])

  const content = (
    <main
      className={`min-h-screen px-6 sm:px-12 py-20 max-w-3xl mx-auto ${authed ? 'nav-bottom-pad' : ''}`}
      style={{ color: 'var(--fg)' }}
    >
        {!authed && (
          <a href="/" className="text-[12px] font-medium" style={{ color: 'var(--fg-faint)' }}>&larr; Demist</a>
        )}

        <h1 className={`text-[32px] sm:text-[42px] font-bold tracking-tight mb-4 leading-tight ${authed ? '' : 'mt-8'}`}>
          Built for students who find lectures harder to follow
        </h1>
        <p className="text-[16px] leading-relaxed mb-14" style={{ color: 'var(--fg-muted)' }}>
          Demist explains unfamiliar terms the moment they&apos;re said, then turns every lecture into a personal glossary and a set of flashcards. No manual note-taking required. It&apos;s free for students, and it&apos;s the kind of support some students access through their Disabled Students&apos; Allowance (DSA).
        </p>

        <section className="mb-16">
          <h2 className="text-[13px] font-bold tracking-[0.16em] uppercase mb-6" style={{ color: 'var(--fg-faint)' }}>
            Who this helps
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {useCases.map(u => (
              <div key={u.title} className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <p className="text-[15px] font-semibold mb-2" style={{ color: 'var(--fg)' }}>{u.title}</p>
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--fg-muted)' }}>{u.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-16">
          <h2 className="text-[13px] font-bold tracking-[0.16em] uppercase mb-6" style={{ color: 'var(--fg-faint)' }}>
            For needs assessors
          </h2>
          <div className="rounded-2xl p-7" style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-border)' }}>
            <p className="text-[14px] leading-relaxed mb-4" style={{ color: 'var(--fg)' }}>
              A sample line for a needs assessment report:
            </p>
            <p className="text-[13px] leading-relaxed italic mb-5" style={{ color: 'var(--fg-muted)' }}>
              &ldquo;[Student] experiences difficulty processing and retaining spoken information during lectures, which affects note-taking and engagement. Demist is recommended as it provides real-time explanations of unfamiliar terms during lectures, alongside automatically generated notes and flashcards, reducing the cognitive load of listening and writing simultaneously.&rdquo;
            </p>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
              Demist is free to use. There&apos;s no licence to purchase or equipment to fund, which means no procurement delay for the student. If you&apos;d like to discuss how it fits alongside existing DSA-funded software, email <a href="mailto:hello@demist.app" className="underline">hello@demist.app</a>.
            </p>
          </div>
        </section>

        <section className="mb-16">
          <h2 className="text-[13px] font-bold tracking-[0.16em] uppercase mb-6" style={{ color: 'var(--fg-faint)' }}>
            How it works
          </h2>
          <div className="space-y-3">
            {[
              'A student starts a session before or during a lecture.',
              'Demist listens and shows a definition the moment an unfamiliar term comes up, without interrupting the flow of the lecture.',
              'After the lecture, every term is saved to a personal glossary and turned into flashcards for revision.',
            ].map((step, i) => (
              <div key={step} className="flex gap-4 items-start rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="text-[13px] font-bold shrink-0 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--fg-muted)' }}>
                  {i + 1}
                </span>
                <p className="text-[14px] leading-relaxed pt-0.5" style={{ color: 'var(--fg-muted)' }}>{step}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-16">
          <h2 className="text-[13px] font-bold tracking-[0.16em] uppercase mb-6" style={{ color: 'var(--fg-faint)' }}>
            Accessibility of Demist itself
          </h2>
          <p className="text-[14px] leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
            Demist is built to meet WCAG 2.1 AA contrast standards, works with browser zoom, and respects reduced-motion settings. If something doesn&apos;t work with the assistive technology you use, tell us at <a href="mailto:hello@demist.app" className="underline">hello@demist.app</a> and we&apos;ll fix it.
          </p>
        </section>

        {!authed && (
          <a
            href="/login"
            className="inline-block px-7 py-3.5 rounded-2xl text-[14px] font-semibold transition-colors"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}
          >
            Try Demist free
          </a>
        )}
    </main>
  )

  if (!authed) return content

  return (
    <>
      <AppNav />
      <div className="sm:pt-14">{content}</div>
    </>
  )
}
