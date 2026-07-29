import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Support',
  description: 'Help with Demist: getting started, recording problems, term cards, your data, and how to get in touch.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://demist.app/support' },
}

const SUPPORT_EMAIL = 'hello@demist.app'

// Grouped by what the person is actually trying to do, not by which part of
// the system is at fault - someone whose transcript is empty does not know
// whether that is the microphone, the models or the network.
const SECTIONS: { title: string; items: { q: string; a: React.ReactNode }[] }[] = [
  {
    title: 'Getting started (Windows app)',
    items: [
      {
        q: 'The first launch is taking a long time — is it stuck?',
        a: <>Almost certainly not. The first time you open Demist it downloads the AI models it uses to work offline, which are several gigabytes in total. On a slow connection this can take a while. You’ll see a progress bar under the record button. It only happens once — after that the app starts in a couple of seconds, and everything works without an internet connection except signing in.</>,
      },
      {
        q: 'The record button is greyed out',
        a: <>That means the transcription model isn’t loaded yet — the text under it will say <em>Preparing on-device models…</em> or show a download percentage. Wait for it to finish. If it stays greyed out after the download completes, close the app fully and reopen it.</>,
      },
      {
        q: 'Do I need an account?',
        a: <>Not on the Windows app. Choose <em>Start without an account</em> and everything works — recording, term cards, flashcards, your glossary. The catch is that an account with no email address cannot be recovered: if you reinstall Windows or clear the app’s data, it’s gone. You can add an email at any time in Settings, which keeps the same account and everything in it.</>,
      },
      {
        q: 'It says Demist can’t reach the internet',
        a: <>Demist loads its interface from demist.app, so it needs a connection to start even though the transcription itself runs on your computer. Check your connection and press <em>Try again</em>. Your downloaded models and anything already recorded are safe.</>,
      },
    ],
  },
  {
    title: 'Recording and transcription',
    items: [
      {
        q: 'I’m recording but no text appears',
        a: <>Give it a few seconds — Demist waits for a natural pause before transcribing, so the first line usually appears about three to five seconds after you start talking. If nothing appears after that, check Windows has given Demist microphone access: <em>Settings → Privacy &amp; security → Microphone</em>, and make sure both microphone access and access for desktop apps are on.</>,
      },
      {
        q: 'The wrong microphone is being used',
        a: <>Pick the one you want in Demist’s own Settings, under Microphone. If your device isn’t listed, click into the list once to allow device names to load, or reconnect the microphone and check again.</>,
      },
      {
        q: 'The transcript lags behind the speaker',
        a: <>A second or two behind is normal and expected — Demist transcribes complete phrases rather than individual words. If it drifts much further than that, close other heavy applications: transcription runs entirely on your computer’s processor, so it competes with whatever else is running. On a slower machine you can switch the transcription model to <em>Fast</em> in Settings, which roughly halves the work at some cost to accuracy.</>,
      },
      {
        q: 'The transcript is inaccurate',
        a: <>The most common cause is a quiet or distant microphone. Move closer to it, or raise the input level in <em>Windows Settings → System → Sound → Input</em>. If your machine has the memory for it, make sure the transcription model in Demist’s Settings is set to <em>Accurate</em> rather than <em>Fast</em>. Background noise and heavy crosstalk will also reduce accuracy.</>,
      },
    ],
  },
  {
    title: 'Term cards and flashcards',
    items: [
      {
        q: 'No term cards are appearing',
        a: <>Term cards only appear for subject-specific vocabulary a student would plausibly need explained, so an introduction or general discussion may produce none at all. They also arrive a little after the transcript, because the term-detection model runs once enough has been said to judge it. If none appear across a whole lecture, check Settings shows a term-detection model as loaded.</>,
      },
      {
        q: 'It’s flagging ordinary words',
        a: <>Open Settings and check which term-detection model is selected. The smallest one is less able to tell jargon from ordinary speech and is only intended for machines with under 8GB of memory. If yours has more, choose <em>Small</em> — it is noticeably more precise. You can dismiss any card you don’t want and it won’t be saved.</>,
      },
      {
        q: 'Can I use Demist for a subject in another language?',
        a: <>Not yet. Transcription is English-only. If you study in English and would like definitions translated into another language, set your translation language in Settings — Mandarin, Arabic, Hindi, Spanish and French are supported.</>,
      },
    ],
  },
  {
    title: 'Your account and data',
    items: [
      {
        q: 'Where is my lecture audio sent?',
        a: <>In the Windows app, nowhere. Transcription, term detection and translation all run on your computer, and your audio never leaves it. Your glossary, flashcards and session history do sync to your account so they’re available across devices. The <Link href="/privacy" className="underline underline-offset-2">privacy policy</Link> sets out exactly what is stored and what isn’t.</>,
      },
      {
        q: 'How do I delete my data?',
        a: <>Go to <em>Settings → Delete account</em>, type DELETE to confirm, and everything stored against your account — profile, transcripts, terms, sessions and flashcard history — is removed immediately. It cannot be undone. If you can’t sign in, email us and we’ll do it for you.</>,
      },
      {
        q: 'Can I move my glossary to another computer?',
        a: <>Yes, as long as your account has an email address on it. Sign in on the other machine and your terms, flashcards and history are already there. If you started without an account, add an email in Settings first — that keeps the same account rather than starting a new one.</>,
      },
    ],
  },
]

export default function Support() {
  return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 px-6 py-16">
      <div className="max-w-[680px] mx-auto">
        <Link href="/" className="text-[11px] font-bold tracking-[0.2em] dark:text-yellow-400/70 text-yellow-700 uppercase dark:hover:text-yellow-400 hover:text-yellow-600 transition-colors">
          ← Demist
        </Link>

        <h1 className="text-[34px] font-bold tracking-tight mt-8 mb-2">Support</h1>
        <p className="dark:text-gray-400 text-gray-700 text-[15px] leading-relaxed mb-4">
          Answers to the things people most often get stuck on. If yours isn’t here, email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="dark:text-yellow-400 text-yellow-700 dark:hover:text-yellow-300 hover:text-yellow-600 transition-colors">{SUPPORT_EMAIL}</a>
          {' '}and we’ll get back to you.
        </p>
        <p className="dark:text-gray-500 text-gray-600 text-[13px] leading-relaxed mb-12">
          It helps if you say which version you’re using (the Windows app or the website), what you were doing, and what happened instead.
        </p>

        <div className="space-y-12">
          {SECTIONS.map(section => (
            <section key={section.title}>
              <h2 className="text-[17px] font-semibold mb-5">{section.title}</h2>
              <div className="space-y-6">
                {section.items.map(item => (
                  <div key={item.q}>
                    <h3 className="text-[15px] font-medium mb-1.5">{item.q}</h3>
                    <p className="dark:text-gray-400 text-gray-700 text-[15px] leading-relaxed">{item.a}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="mt-14 pt-10 border-t dark:border-white/[0.08] border-black/[0.08]">
          <h2 className="text-[17px] font-semibold mb-3">Still stuck?</h2>
          <p className="dark:text-gray-400 text-gray-700 text-[15px] leading-relaxed">
            Email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="dark:text-yellow-400 text-yellow-700 dark:hover:text-yellow-300 hover:text-yellow-600 transition-colors">{SUPPORT_EMAIL}</a>.
            {' '}For anything about your personal data specifically, write to{' '}
            <a href="mailto:privacy@demist.app" className="dark:text-yellow-400 text-yellow-700 dark:hover:text-yellow-300 hover:text-yellow-600 transition-colors">privacy@demist.app</a>
            {' '}— see the <Link href="/privacy" className="underline underline-offset-2">privacy policy</Link> for how we handle it.
          </p>
        </section>

        <div className="mt-16 pt-8 border-t dark:border-white/[0.05] border-black/[0.08]">
          <Link href="/" className="text-[13px] dark:text-gray-600 text-gray-500 dark:hover:text-gray-400 hover:text-gray-700 transition-colors">
            ← Back to Demist
          </Link>
        </div>
      </div>
    </main>
  )
}
