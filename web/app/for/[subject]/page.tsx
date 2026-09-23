import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SUBJECT_PAGES, getSubjectPage } from '@/lib/subjectPages'
import { MS_STORE_URL } from '@/lib/links'

// Statically generated at build time, one page per subject. These are
// marketing pages read by search crawlers and by models answering "what
// should I use for nursing lectures", so they must be plain HTML on a real
// URL, not something that needs JavaScript to say anything.
export async function generateStaticParams() {
  return SUBJECT_PAGES.map(p => ({ subject: p.slug }))
}

export const dynamicParams = false

export async function generateMetadata(props: PageProps<'/for/[subject]'>): Promise<Metadata> {
  const { subject } = await props.params
  const page = getSubjectPage(subject)
  if (!page) return {}
  const url = `https://demist.app/for/${page.slug}`
  return {
    title: page.title,
    description: page.description,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: { title: page.title, description: page.description, url, type: 'website' },
  }
}

export default async function SubjectLanding(props: PageProps<'/for/[subject]'>) {
  const { subject } = await props.params
  const page = getSubjectPage(subject)
  if (!page) notFound()

  // A FAQPage graph of the same terms shown on the page. Search engines and
  // assistants both read this, and it is the machine-readable version of the
  // thing the page is actually for: proving Demist knows this subject's
  // vocabulary rather than asserting it.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: page.terms.map(t => ({
      '@type': 'Question',
      name: `What does "${t.term}" mean?`,
      acceptedAnswer: { '@type': 'Answer', text: t.definition },
    })),
  }

  return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 px-6 py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="max-w-[680px] mx-auto">
        <Link href="/" className="text-[11px] font-bold tracking-[0.2em] dark:text-yellow-400/70 text-yellow-700 uppercase dark:hover:text-yellow-400 hover:text-yellow-600 transition-colors">
          ← Demist
        </Link>

        <h1 className="text-[34px] sm:text-[40px] font-bold tracking-tight leading-[1.1] mt-8 mb-4">
          {page.title}
        </h1>

        <p className="text-[17px] leading-relaxed dark:text-gray-300 text-gray-700 mb-10">
          {page.problem}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mb-14">
          <Link
            href="/login"
            className="px-7 py-4 rounded-2xl bg-yellow-600 hover:brightness-[1.1] text-white font-semibold text-[15px] text-center transition-all active:scale-[0.97]"
          >
            Try it free →
          </Link>
          <a
            href={MS_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-7 py-4 rounded-2xl font-semibold text-[15px] text-center transition-all active:scale-[0.97] dark:bg-white/[0.05] bg-[#FAF9F6] border dark:border-white/[0.08] border-black/[0.12] dark:text-white text-gray-900"
          >
            Get the Windows app
          </a>
        </div>

        <div className="space-y-12 text-[15px] leading-relaxed">
          <section>
            <h2 className="text-[19px] font-semibold mb-3">What it does during a {page.subject} lecture</h2>
            <p className="dark:text-gray-400 text-gray-700 mb-4">
              Demist transcribes as your lecturer speaks, picks out the terms you are unlikely to
              know at your year of study, and puts a one-sentence explanation on screen while they
              are still talking. You keep listening instead of writing down a word to look up later.
            </p>
            <p className="dark:text-gray-400 text-gray-700">
              Afterwards you have the full transcript, a glossary of every term that came up, a
              summary, and flashcards scheduled by spaced repetition so you revise something shortly
              before you would have forgotten it.
            </p>
          </section>

          <section>
            <h2 className="text-[19px] font-semibold mb-4">
              The kind of {page.subject} terminology it explains
            </h2>
            <div className="space-y-3">
              {page.terms.map(t => (
                <div
                  key={t.term}
                  className="rounded-2xl px-5 py-4 dark:bg-white/[0.04] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.08]"
                >
                  <p className="font-semibold text-[15px] mb-1">{t.term}</p>
                  <p className="text-[14px] dark:text-gray-400 text-gray-700 leading-relaxed">{t.definition}</p>
                </div>
              ))}
            </div>
            <p className="text-[13px] dark:text-gray-600 text-gray-500 mt-4">
              Explanations are written for your year of study and the subject you set up, so a first
              year and a finalist get different levels of detail for the same word.
            </p>
          </section>

          <section>
            <h2 className="text-[19px] font-semibold mb-3">{page.note.heading}</h2>
            <p className="dark:text-gray-400 text-gray-700">{page.note.body}</p>
          </section>

          <section>
            <h2 className="text-[19px] font-semibold mb-3">It runs on your own computer</h2>
            <p className="dark:text-gray-400 text-gray-700">
              The Windows and Mac apps do the transcription, the term detection and the explanations
              with AI models running locally on your machine, so your lecture audio never leaves your
              computer. Your transcript and glossary sync to your account so you can see them on the
              web and keep your history if you reinstall. There is also a browser version if you would
              rather not install anything.
            </p>
          </section>

          <section>
            <h2 className="text-[19px] font-semibold mb-3">What it costs</h2>
            <p className="dark:text-gray-400 text-gray-700">
              Recording, live explanations, translation, your glossary and your flashcards are free
              and unlimited in the app, with no advertising. Free accounts keep lecture history for
              seven days. Demist Pro keeps your whole term, records in the browser with no limit,
              and adds unlimited summaries and Anki export for £4.99 a month. New accounts get Pro
              free for their first 30 days, with no card.
            </p>
          </section>

          <section>
            <h2 className="text-[19px] font-semibold mb-3">Built for students who find lectures harder to follow</h2>
            <p className="dark:text-gray-400 text-gray-700">
              Demist exists for {page.audience} with a hearing impairment, with dyslexia, who find
              holding attention difficult, or who are studying in English as a second language. If
              that is you, it is worth trying for one lecture.
            </p>
          </section>
        </div>

        <div className="mt-14 pt-10 border-t dark:border-white/[0.08] border-black/[0.1]">
          <Link
            href="/login"
            className="inline-block px-7 py-4 rounded-2xl bg-yellow-600 hover:brightness-[1.1] text-white font-semibold text-[15px] transition-all active:scale-[0.97]"
          >
            Try Demist free →
          </Link>
          <p className="text-[13px] dark:text-gray-600 text-gray-500 mt-6">
            Also for{' '}
            {SUBJECT_PAGES.filter(p => p.slug !== page.slug).map((p, i, arr) => (
              <span key={p.slug}>
                <Link href={`/for/${p.slug}`} className="underline underline-offset-2 dark:hover:text-gray-400 hover:text-gray-700">
                  {p.audience}
                </Link>
                {i < arr.length - 1 ? ', ' : '.'}
              </span>
            ))}
          </p>
        </div>
      </div>
    </main>
  )
}
