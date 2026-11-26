import type { Metadata } from 'next'
import Link from 'next/link'
import { MS_STORE_URL } from '@/lib/links'
import { NOTES_PAGE, NOTES_PAGE_REVIEWED, NOTES_PAGE_URL } from '@/lib/notesPage'

// Lecture notes, answered the way students ask for them. Content and the
// reasons for it: lib/notesPage.ts (also served in llms-full.txt).

const { title, description } = NOTES_PAGE

export const metadata: Metadata = {
  title,
  description,
  robots: { index: true, follow: true },
  alternates: { canonical: NOTES_PAGE_URL },
  openGraph: { title, description, url: NOTES_PAGE_URL, type: 'article' },
}

export default function LectureNotesPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: NOTES_PAGE.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }
  const reviewed = new Date(NOTES_PAGE_REVIEWED).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <main className="min-h-dvh dark:bg-[#110B1C] bg-[#F3F0F8] dark:text-white text-gray-900 px-6 py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <div className="max-w-[680px] mx-auto">
        <Link href="/" className="text-[11px] font-bold tracking-[0.2em] dark:text-brand-400/70 text-brand-700 uppercase dark:hover:text-brand-400 hover:text-brand-600 transition-colors">
          ← Demist
        </Link>

        <h1 className="text-[32px] sm:text-[40px] font-bold tracking-tight leading-[1.1] mt-8 mb-4">{title}</h1>
        <p className="text-[17px] leading-relaxed dark:text-gray-300 text-gray-700 mb-12">{NOTES_PAGE.answer}</p>

        <div className="space-y-10 text-[15px] leading-relaxed">
          {NOTES_PAGE.sections.map(s => (
            <section key={s.heading}>
              <h2 className="text-[19px] font-semibold mb-3">{s.heading}</h2>
              <p className="dark:text-gray-400 text-gray-700">
                {s.body}
                {s.heading === 'Where notes are made' && (
                  <> <Link href="/privacy" className="underline underline-offset-2">Read the privacy policy</Link>.</>
                )}
              </p>
            </section>
          ))}

          <section>
            <h2 className="text-[19px] font-semibold mb-3">What it will not do</h2>
            <ul className="list-disc pl-5 space-y-2 dark:text-gray-400 text-gray-700">
              {NOTES_PAGE.notFor.map(n => <li key={n}>{n}</li>)}
            </ul>
          </section>

          <section>
            <h2 className="text-[19px] font-semibold mb-4">Questions</h2>
            <div className="space-y-5">
              {NOTES_PAGE.faq.map(f => (
                <div key={f.q}>
                  <h3 className="text-[15px] font-semibold mb-1">{f.q}</h3>
                  <p className="dark:text-gray-400 text-gray-700">{f.a}</p>
                </div>
              ))}
            </div>
          </section>

          <p className="text-[13px] dark:text-gray-500 text-gray-600">
            Checked against the app on {reviewed}. More: <Link href="/for/adhd" className="underline underline-offset-2">ADHD</Link>,{' '}
            <Link href="/for/dyslexia" className="underline underline-offset-2">dyslexia</Link>,{' '}
            <Link href="/compare/genio" className="underline underline-offset-2">Demist vs Genio</Link>,{' '}
            <Link href="/lecture-recordings" className="underline underline-offset-2">recorded lectures</Link>.
          </p>
        </div>

        <div className="mt-14 pt-10 border-t dark:border-white/[0.08] border-black/[0.1] flex flex-col sm:flex-row gap-3">
          <Link href="/login" className="px-7 py-4 rounded-2xl bg-brand-600 hover:brightness-[1.1] text-white font-semibold text-[15px] text-center transition-all active:scale-[0.97]">
            Try Demist free →
          </Link>
          <a href={MS_STORE_URL} target="_blank" rel="noopener noreferrer" className="px-7 py-4 rounded-2xl font-semibold text-[15px] text-center transition-all active:scale-[0.97] dark:bg-white/[0.05] bg-[#FFFFFF] border dark:border-white/[0.08] border-black/[0.12]">
            Get the Windows app
          </a>
        </div>
      </div>
    </main>
  )
}
