import type { Metadata } from 'next'
import Link from 'next/link'
import { LECTURER_PAGE, LECTURER_PAGE_URL, LECTURER_PAGE_REVIEWED } from '@/lib/lecturerPage'
import { CopyMessage } from './copy-message'

// For lecturers deciding whether to tell a class about Demist. Content and its
// rules: lib/lecturerPage.ts (also in llms-full.txt).
const { title, description } = LECTURER_PAGE

export const metadata: Metadata = {
  title,
  description,
  robots: { index: true, follow: true },
  alternates: { canonical: LECTURER_PAGE_URL },
  openGraph: { title, description, url: LECTURER_PAGE_URL, type: 'article' },
}

export default function LecturersPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: LECTURER_PAGE.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }
  const reviewed = new Date(LECTURER_PAGE_REVIEWED).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const muted = 'dark:text-gray-400 text-gray-700'
  return (
    <main className="min-h-dvh dark:bg-[#110B1C] bg-[#F3F0F8] dark:text-white text-gray-900 px-6 py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <div className="max-w-[680px] mx-auto">
        <Link href="/" className="text-[11px] font-bold tracking-[0.2em] dark:text-brand-400/70 text-brand-700 uppercase dark:hover:text-brand-400 hover:text-brand-600 transition-colors">
          ← Demist
        </Link>
        <h1 className="text-[32px] sm:text-[40px] font-bold tracking-tight leading-[1.1] mt-8 mb-4">{title}</h1>
        <p className="text-[17px] leading-relaxed dark:text-gray-300 text-gray-700 mb-12">{LECTURER_PAGE.answer}</p>

        <section className="mb-12 rounded-2xl p-6 dark:bg-white/[0.04] bg-white border dark:border-white/[0.08] border-black/[0.08]">
          <h2 className="text-[19px] font-semibold mb-2">A message you can post for your class</h2>
          <p className={`text-[14px] ${muted} mb-4`}>For your Moodle, Canvas or Blackboard page, or the first slide of a lecture.</p>
          <CopyMessage text={LECTURER_PAGE.shareMessage} />
        </section>

        <div className="space-y-10 text-[15px] leading-relaxed">
          {LECTURER_PAGE.sections.map(s => (
            <section key={s.heading}>
              <h2 className="text-[19px] font-semibold mb-3">{s.heading}</h2>
              <p className={muted}>{s.body}</p>
            </section>
          ))}
          <section>
            <h2 className="text-[19px] font-semibold mb-3">What it will not do</h2>
            <ul className={`list-disc pl-5 space-y-2 ${muted}`}>
              {LECTURER_PAGE.notFor.map(n => <li key={n}>{n}</li>)}
            </ul>
          </section>
          <section>
            <h2 className="text-[19px] font-semibold mb-4">Questions</h2>
            <div className="space-y-5">
              {LECTURER_PAGE.faq.map(f => (
                <div key={f.q}>
                  <h3 className="text-[15px] font-semibold mb-1">{f.q}</h3>
                  <p className={muted}>{f.a}</p>
                </div>
              ))}
            </div>
          </section>
          <p className="text-[13px] dark:text-gray-500 text-gray-600">
            Checked against the app on {reviewed}. More: <Link href="/lecture-notes" className="underline underline-offset-2">lecture notes</Link>,{' '}
            <Link href="/best/lecture-apps-for-adhd" className="underline underline-offset-2">lecture apps for ADHD</Link>,{' '}
            <Link href="/best/lecture-apps-for-deaf-students" className="underline underline-offset-2">for deaf and hard of hearing students</Link>,{' '}
            <Link href="/privacy" className="underline underline-offset-2">privacy</Link>.
          </p>
        </div>
      </div>
    </main>
  )
}
