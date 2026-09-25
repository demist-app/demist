import type { Metadata } from 'next'
import Link from 'next/link'
import { MS_STORE_URL } from '@/lib/links'

// How to use Demist with a university's own lecture recordings (Panopto,
// Teams, Zoom) and with uploaded files. Its own page because it is the
// cleanest way in: the university made the recording, the student plays it
// back, nobody is being recorded who did not agree to it. Every step here
// matches the product as it ships (dashboard capture modes, the Import page's
// formats and limits); update both together.

const title = "Using Demist with your university's lecture recordings"
const description =
  'Follow a recorded lecture on Panopto, Teams or Zoom with Demist explaining unfamiliar terms as they come up, or upload a recording file. Steps for the browser and the Windows app.'
const url = 'https://www.demist.app/lecture-recordings'

export const metadata: Metadata = {
  title,
  description,
  robots: { index: true, follow: true },
  alternates: { canonical: url },
  openGraph: { title, description, url, type: 'article' },
}

const FAQ = [
  {
    q: 'Can Demist listen to a Panopto recording?',
    a: 'Yes. Play the recording in a browser tab and choose Tab capture in Demist, or use System audio in the Windows app. Demist explains unfamiliar terms as the recording plays, and you can pause or rewind whenever you like.',
  },
  {
    q: 'Can I upload a lecture recording instead?',
    a: 'Yes, if your university lets you download it. Demist accepts MP3, WAV, M4A, MP4, WebM and OGG files up to 50 MB, which is roughly two to three hours of typical audio. Uploads are transcribed on our server in every version of Demist.',
  },
  {
    q: 'Do I need permission to use a recorded lecture?',
    a: 'Playing back a recording your university has given you access to is normally fine, but downloading or sharing it may not be. Check your university\'s rules on lecture recordings. Demist does not get around any access restrictions.',
  },
]

export default function LectureRecordingsPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }
  return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 px-6 py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <div className="max-w-[680px] mx-auto">
        <Link href="/" className="text-[11px] font-bold tracking-[0.2em] dark:text-yellow-400/70 text-yellow-700 uppercase dark:hover:text-yellow-400 hover:text-yellow-600 transition-colors">
          ← Demist
        </Link>

        <h1 className="text-[32px] sm:text-[40px] font-bold tracking-tight leading-[1.1] mt-8 mb-4">{title}</h1>
        <p className="text-[17px] leading-relaxed dark:text-gray-300 text-gray-700 mb-12">
          If your lectures are recorded on Panopto, Teams or Zoom, you can watch the recording with Demist
          listening alongside. It explains unfamiliar terms as they come up, and because it is a recording,
          you can pause on any of them for as long as you need.
        </p>

        <div className="space-y-12 text-[15px] leading-relaxed">
          <section>
            <h2 className="text-[19px] font-semibold mb-3">In the browser</h2>
            <p className="dark:text-gray-400 text-gray-700 mb-3">Use Chrome or Edge on a computer.</p>
            <ol className="list-decimal pl-5 space-y-2 dark:text-gray-400 text-gray-700">
              <li>Open the lecture recording in its own tab.</li>
              <li>In Demist, choose <strong className="dark:text-gray-200 text-gray-900">Tab capture</strong> and press record.</li>
              <li>Pick the tab with the recording, and tick <strong className="dark:text-gray-200 text-gray-900">Share tab audio</strong>.</li>
              <li>Press play on the recording. Terms and their explanations appear in Demist as the lecturer says them.</li>
            </ol>
            <p className="dark:text-gray-400 text-gray-700 mt-3">
              The browser version sends the audio to our server to be transcribed. Free accounts get three
              recordings in the browser; Pro removes the limit.
            </p>
          </section>

          <section>
            <h2 className="text-[19px] font-semibold mb-3">In the Windows app</h2>
            <ol className="list-decimal pl-5 space-y-2 dark:text-gray-400 text-gray-700">
              <li>Choose <strong className="dark:text-gray-200 text-gray-900">System audio</strong> and press record.</li>
              <li>Play the recording in any browser or app.</li>
            </ol>
            <p className="dark:text-gray-400 text-gray-700 mt-3">
              System audio listens to everything playing on the computer, so close anything else making sound.
              In the Windows app the lecture audio is transcribed on your own computer, and recording is free
              and unlimited.
            </p>
          </section>

          <section>
            <h2 className="text-[19px] font-semibold mb-3">Upload a recording</h2>
            <p className="dark:text-gray-400 text-gray-700">
              If you can download the recording, open <strong className="dark:text-gray-200 text-gray-900">Import</strong> in
              Demist and upload it: MP3, WAV, M4A, MP4, WebM or OGG, up to 50 MB. Demist transcribes it, picks
              out the terms and explains them, and adds them to your glossary and flashcards. Uploads are
              transcribed on our server in every version, and the file is deleted once it has been processed.
            </p>
          </section>

          <section>
            <h2 className="text-[19px] font-semibold mb-4">Questions</h2>
            <div className="space-y-5">
              {FAQ.map(f => (
                <div key={f.q}>
                  <h3 className="text-[15px] font-semibold mb-1">{f.q}</h3>
                  <p className="dark:text-gray-400 text-gray-700">{f.a}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-14 pt-10 border-t dark:border-white/[0.08] border-black/[0.1] flex flex-col sm:flex-row gap-3">
          <Link href="/login" className="px-7 py-4 rounded-2xl bg-yellow-600 hover:brightness-[1.1] text-white font-semibold text-[15px] text-center transition-all active:scale-[0.97]">
            Try Demist free →
          </Link>
          <a href={MS_STORE_URL} target="_blank" rel="noopener noreferrer" className="px-7 py-4 rounded-2xl font-semibold text-[15px] text-center transition-all active:scale-[0.97] dark:bg-white/[0.05] bg-[#FAF9F6] border dark:border-white/[0.08] border-black/[0.12]">
            Get the Windows app
          </a>
        </div>
      </div>
    </main>
  )
}
