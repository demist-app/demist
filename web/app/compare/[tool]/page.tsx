import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { COMPARE_PAGES, getComparePage } from '@/lib/comparePages'
import { MS_STORE_URL } from '@/lib/links'

// Statically generated, one page per competitor, for the same reason as the
// /for pages: plain HTML on a real URL that search crawlers and AI assistants
// can read without running JavaScript. The facts live in lib/comparePages.ts,
// with their sources and the date they were checked.
export async function generateStaticParams() {
  return COMPARE_PAGES.map(p => ({ tool: p.slug }))
}

export const dynamicParams = false

export async function generateMetadata(props: PageProps<'/compare/[tool]'>): Promise<Metadata> {
  const { tool } = await props.params
  const page = getComparePage(tool)
  if (!page) return {}
  const url = `https://www.demist.app/compare/${page.slug}`
  return {
    title: page.title,
    description: page.description,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: { title: page.title, description: page.description, url, type: 'article' },
  }
}

export default async function ComparePageView(props: PageProps<'/compare/[tool]'>) {
  const { tool } = await props.params
  const page = getComparePage(tool)
  if (!page) notFound()

  // FAQPage markup of exactly the questions shown below, nothing more.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: page.faq.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
  const checked = new Date(page.checkedOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 px-6 py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <div className="max-w-[760px] mx-auto">
        <Link href="/" className="text-[11px] font-bold tracking-[0.2em] dark:text-yellow-400/70 text-yellow-700 uppercase dark:hover:text-yellow-400 hover:text-yellow-600 transition-colors">
          ← Demist
        </Link>

        <h1 className="text-[32px] sm:text-[40px] font-bold tracking-tight leading-[1.1] mt-8 mb-5">
          {page.title}
        </h1>

        <p className="text-[17px] leading-relaxed dark:text-gray-300 text-gray-700 mb-10">
          {page.verdict}
        </p>

        <section className="mb-12">
          <h2 className="text-[19px] font-semibold mb-4">Side by side</h2>
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full min-w-[560px] text-[14px] border-collapse">
              <thead>
                <tr className="text-left">
                  <th className="py-3 pr-4 w-[28%] font-semibold dark:text-gray-400 text-gray-600" scope="col"><span className="sr-only">Feature</span></th>
                  <th className="py-3 pr-4 w-[36%] font-semibold" scope="col">Demist</th>
                  <th className="py-3 w-[36%] font-semibold" scope="col">{page.name}</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map(r => (
                  <tr key={r.label} className="border-t dark:border-white/[0.08] border-black/[0.1] align-top">
                    <th scope="row" className="py-3 pr-4 text-left font-medium dark:text-gray-300 text-gray-800">{r.label}</th>
                    <td className="py-3 pr-4 dark:text-gray-400 text-gray-700 leading-relaxed">{r.demist}</td>
                    <td className="py-3 dark:text-gray-400 text-gray-700 leading-relaxed">{r.them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-[19px] font-semibold mb-3">When {page.name} is the better choice</h2>
          <ul className="list-disc pl-5 space-y-2 dark:text-gray-400 text-gray-700 leading-relaxed">
            {page.themBetter.map(t => <li key={t}>{t}</li>)}
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="text-[19px] font-semibold mb-4">Questions</h2>
          <div className="space-y-5">
            {page.faq.map(f => (
              <div key={f.q}>
                <h3 className="text-[15px] font-semibold mb-1">{f.q}</h3>
                <p className="text-[15px] dark:text-gray-400 text-gray-700 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="flex flex-col sm:flex-row gap-3 mb-12">
          <Link href="/login" className="px-7 py-4 rounded-2xl bg-yellow-600 hover:brightness-[1.1] text-white font-semibold text-[15px] text-center transition-all active:scale-[0.97]">
            Try Demist free →
          </Link>
          <a href={MS_STORE_URL} target="_blank" rel="noopener noreferrer" className="px-7 py-4 rounded-2xl font-semibold text-[15px] text-center transition-all active:scale-[0.97] dark:bg-white/[0.05] bg-[#FAF9F6] border dark:border-white/[0.08] border-black/[0.12]">
            Get the Windows app
          </a>
        </div>

        <footer className="pt-8 border-t dark:border-white/[0.08] border-black/[0.1] text-[13px] dark:text-gray-600 text-gray-500 leading-relaxed">
          <p className="mb-2">
            Facts about {page.name} are taken from its own pages, checked on {checked}. Products change;
            if something here is out of date, tell us at <a href="mailto:hello@demist.app" className="underline">hello@demist.app</a> and we will correct it.
          </p>
          <p>
            Sources:{' '}
            {page.sources.map((s, i) => (
              <span key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{s.label}</a>
                {i < page.sources.length - 1 ? ', ' : '.'}
              </span>
            ))}
          </p>
        </footer>
      </div>
    </main>
  )
}
