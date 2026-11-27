import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BEST_PAGES, BEST_PAGES_REVIEWED, TOOLS, getBestPage } from '@/lib/bestPages'
import { MS_STORE_URL } from '@/lib/links'

// Roundups of lecture apps for one kind of student. Statically generated, plain
// HTML, for the same reason as /compare: crawlers and assistants read them
// without running JavaScript. Content and its rules: lib/bestPages.ts.
export async function generateStaticParams() {
  return BEST_PAGES.map(p => ({ slug: p.slug }))
}

export const dynamicParams = false

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params
  const page = getBestPage(slug)
  if (!page) return {}
  const url = `https://www.demist.app/best/${page.slug}`
  return {
    title: page.title,
    description: page.description,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: { title: page.title, description: page.description, url, type: 'article' },
  }
}

const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

export default async function BestPageView(props: Props) {
  const { slug } = await props.params
  const page = getBestPage(slug)
  if (!page) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ItemList',
        name: page.title,
        itemListElement: page.picks.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: TOOLS[p.tool].name.replace(' (ours)', '') })),
      },
      {
        '@type': 'FAQPage',
        mainEntity: page.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      },
    ],
  }
  const sources = [...new Map(page.picks.flatMap(p => TOOLS[p.tool].sources.map(s => [s.url, { ...s, checked: TOOLS[p.tool].checked }]))).values()]
  const muted = 'dark:text-gray-400 text-gray-700'

  return (
    <main className="min-h-dvh dark:bg-[#110B1C] bg-[#F3F0F8] dark:text-white text-gray-900 px-6 py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <div className="max-w-[760px] mx-auto">
        <Link href="/" className="text-[11px] font-bold tracking-[0.2em] dark:text-brand-400/70 text-brand-700 uppercase dark:hover:text-brand-400 hover:text-brand-600 transition-colors">
          ← Demist
        </Link>
        <h1 className="text-[32px] sm:text-[40px] font-bold tracking-tight leading-[1.1] mt-8 mb-5">{page.title}</h1>
        <p className="text-[17px] leading-relaxed dark:text-gray-300 text-gray-700 mb-4">{page.answer}</p>
        <p className={`text-[13px] ${muted} mb-10`}>
          Demist is made by us, Graceful Minds, so we have said where the other tools are the better choice. Facts about other
          apps come from their own websites, linked at the bottom. Reviewed {fmt(BEST_PAGES_REVIEWED)}.
        </p>

        <section className="mb-12">
          <h2 className="text-[19px] font-semibold mb-3">What to look for</h2>
          <ul className={`list-disc pl-5 space-y-2 text-[15px] leading-relaxed ${muted}`}>
            {page.lookFor.map(l => <li key={l}>{l}</li>)}
          </ul>
        </section>

        <div className="space-y-6">
          {page.picks.map((p, i) => {
            const t = TOOLS[p.tool]
            return (
              <section key={p.tool} className="rounded-2xl p-6 dark:bg-white/[0.04] bg-white border dark:border-white/[0.08] border-black/[0.08]">
                <h2 className="text-[20px] font-semibold">{i + 1}. {t.name}</h2>
                <p className="text-[14px] font-semibold dark:text-brand-400 text-brand-700 mt-1 mb-3">Best for: {p.bestFor}</p>
                <div className="space-y-2 text-[15px] leading-relaxed">
                  <p className={muted}>{p.why}</p>
                  <p className={muted}><strong className="dark:text-gray-200 text-gray-900">Watch out for:</strong> {p.watchOut}</p>
                  <p className={muted}><strong className="dark:text-gray-200 text-gray-900">Price:</strong> {t.price}.</p>
                  <p className={muted}><strong className="dark:text-gray-200 text-gray-900">Runs on:</strong> {t.runsOn}.</p>
                </div>
              </section>
            )
          })}
        </div>

        <section className="mt-12">
          <h2 className="text-[19px] font-semibold mb-4">Questions</h2>
          <div className="space-y-5 text-[15px] leading-relaxed">
            {page.faq.map(f => (
              <div key={f.q}>
                <h3 className="font-semibold mb-1">{f.q}</h3>
                <p className={muted}>{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={`mt-12 text-[13px] ${muted}`}>
          <h2 className="text-[15px] font-semibold mb-2 dark:text-gray-300 text-gray-800">Sources</h2>
          <ul className="space-y-1">
            {sources.map(s => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{s.label}</a>
                {s.checked ? `, read ${fmt(s.checked)}` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-4">
            More: <Link href="/best/lecture-apps-for-adhd" className="underline underline-offset-2">ADHD</Link>,{' '}
            <Link href="/best/lecture-apps-for-dyslexia" className="underline underline-offset-2">dyslexia</Link>,{' '}
            <Link href="/best/lecture-apps-for-deaf-students" className="underline underline-offset-2">deaf and hard of hearing</Link>,{' '}
            <Link href="/best/lecture-apps-for-international-students" className="underline underline-offset-2">international students</Link>,{' '}
            <Link href="/compare/otter" className="underline underline-offset-2">Demist vs Otter</Link>,{' '}
            <Link href="/compare/genio" className="underline underline-offset-2">Demist vs Genio</Link>.
          </p>
        </section>

        <div className="mt-14 pt-10 border-t dark:border-white/[0.08] border-black/[0.1] flex flex-col sm:flex-row gap-3">
          <a href={MS_STORE_URL} target="_blank" rel="noopener noreferrer" className="px-7 py-4 rounded-2xl bg-brand-600 hover:brightness-[1.1] text-white font-semibold text-[15px] text-center transition-all active:scale-[0.97]">
            Get Demist for Windows, free
          </a>
          <Link href="/login" className="px-7 py-4 rounded-2xl font-semibold text-[15px] text-center transition-all active:scale-[0.97] dark:bg-white/[0.05] bg-[#FFFFFF] border dark:border-white/[0.08] border-black/[0.12]">
            Try it in the browser
          </Link>
        </div>
      </div>
    </main>
  )
}
