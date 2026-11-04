import Link from 'next/link'
import { MS_STORE_URL } from '@/lib/links'
import { PRO_PRICE_TEXT } from '@/lib/pricing'
import { NEED_PAGES, NEED_PAGES_REVIEWED, type NeedPage } from '@/lib/needPages'

// Plain server-rendered HTML for the same reason as the subject pages beside
// it: search crawlers and assistants read this without running JavaScript.
export function NeedLanding({ page }: { page: NeedPage }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: page.title,
        description: page.description,
        url: `https://www.demist.app/for/${page.slug}`,
        dateModified: NEED_PAGES_REVIEWED,
        publisher: { '@type': 'Organization', name: 'Graceful Minds', url: 'https://www.graceful-minds.org' },
      },
      {
        '@type': 'FAQPage',
        mainEntity: page.faq.map(f => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  }
  const reviewed = new Date(NEED_PAGES_REVIEWED).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <main className="min-h-dvh dark:bg-[#110B1C] bg-[#F3F0F8] dark:text-white text-gray-900 px-6 py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <div className="max-w-[680px] mx-auto">
        <Link href="/" className="text-[11px] font-bold tracking-[0.2em] dark:text-brand-400/70 text-brand-700 uppercase dark:hover:text-brand-400 hover:text-brand-600 transition-colors">
          ← Demist
        </Link>

        <h1 className="text-[34px] sm:text-[40px] font-bold tracking-tight leading-[1.1] mt-8 mb-4">
          {page.title}
        </h1>

        <p className="text-[17px] leading-relaxed dark:text-gray-300 text-gray-700 mb-10">
          {page.answer}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mb-14">
          <Link
            href="/login"
            className="px-7 py-4 rounded-2xl bg-brand-600 hover:brightness-[1.1] text-white font-semibold text-[15px] text-center transition-all active:scale-[0.97]"
          >
            Try it free →
          </Link>
          <a
            href={MS_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-7 py-4 rounded-2xl font-semibold text-[15px] text-center transition-all active:scale-[0.97] dark:bg-white/[0.05] bg-[#FFFFFF] border dark:border-white/[0.08] border-black/[0.12] dark:text-white text-gray-900"
          >
            Get the Windows app
          </a>
        </div>

        <div className="space-y-12 text-[15px] leading-relaxed">
          <section>
            <h2 className="text-[19px] font-semibold mb-4">How it helps</h2>
            <div className="space-y-3">
              {page.helps.map(h => (
                <div
                  key={h.heading}
                  className="rounded-2xl px-5 py-4 dark:bg-white/[0.04] bg-[#FFFFFF] border dark:border-white/[0.07] border-black/[0.08]"
                >
                  <h3 className="font-semibold text-[15px] mb-1">{h.heading}</h3>
                  <p className="text-[14px] dark:text-gray-400 text-gray-700 leading-relaxed">{h.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-[19px] font-semibold mb-3">What it will not do</h2>
            <ul className="list-disc pl-5 space-y-2 dark:text-gray-400 text-gray-700">
              {page.notFor.map(n => <li key={n}>{n}</li>)}
            </ul>
          </section>

          <section>
            <h2 className="text-[19px] font-semibold mb-4">Questions</h2>
            <div className="space-y-5">
              {page.faq.map(f => (
                <div key={f.q}>
                  <h3 className="font-semibold text-[15px] mb-1">{f.q}</h3>
                  <p className="dark:text-gray-400 text-gray-700">{f.a}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-[19px] font-semibold mb-3">Where your lecture audio goes</h2>
            <p className="dark:text-gray-400 text-gray-700">
              In the Windows app, live lectures are transcribed and explained by software on your own
              computer, so the audio does not leave it. The browser version, and uploading a
              recording in any version, sends audio to our server to be transcribed. The{' '}
              <Link href="/privacy" className="underline underline-offset-2">privacy policy</Link> sets
              out exactly what goes where.
            </p>
          </section>

          <section>
            <h2 className="text-[19px] font-semibold mb-3">What it costs</h2>
            <p className="dark:text-gray-400 text-gray-700">
              Live explanations, translation, your glossary and your flashcards are free, with no
              advertising. Recording is free and unlimited in the Windows app; in the browser, free
              accounts get three recordings. Free accounts keep lecture history for seven days. Demist
              Pro keeps every lecture and adds unlimited summaries and Anki export for{' '}
              {PRO_PRICE_TEXT.monthly} a month. New accounts get Pro free for their first 30 days,
              with no card.
            </p>
          </section>
        </div>

        <div className="mt-14 pt-10 border-t dark:border-white/[0.08] border-black/[0.1]">
          <Link
            href="/login"
            className="inline-block px-7 py-4 rounded-2xl bg-brand-600 hover:brightness-[1.1] text-white font-semibold text-[15px] transition-all active:scale-[0.97]"
          >
            Try Demist free →
          </Link>
          <p className="text-[13px] dark:text-gray-600 text-gray-500 mt-6">
            Also for{' '}
            {NEED_PAGES.filter(p => p.slug !== page.slug).map((p, i, arr) => (
              <span key={p.slug}>
                <Link href={`/for/${p.slug}`} className="underline underline-offset-2 dark:hover:text-gray-400 hover:text-gray-700">
                  {p.audience}
                </Link>
                {i < arr.length - 1 ? ', ' : '.'}
              </span>
            ))}
          </p>
          <p className="text-[12px] dark:text-gray-600 text-gray-500 mt-3">
            Made by Graceful Minds. Checked against the product on {reviewed}.
          </p>
        </div>
      </div>
    </main>
  )
}
