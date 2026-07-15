import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://demist.app/privacy' },
}

export default function Privacy() {
  const updated = '7 July 2026'

  return (
    <main className="min-h-dvh bg-[#080810] text-white px-6 py-16">
      <div className="max-w-[680px] mx-auto">
        <Link href="/" className="text-[11px] font-bold tracking-[0.2em] text-yellow-400/70 uppercase hover:text-yellow-400 transition-colors">
          ← Demist
        </Link>

        <h1 className="text-[34px] font-bold tracking-tight mt-8 mb-2">Privacy Policy</h1>
        <p className="text-gray-600 text-[14px] mb-12">Last updated {updated}</p>

        <div className="space-y-10 text-[15px] leading-relaxed">

          <section>
            <h2 className="text-[17px] font-semibold mb-3">What Demist does</h2>
            <p className="text-gray-400">
              Demist transcribes your lectures, reads them back, and explains and translates unfamiliar terminology in real time, building a personal glossary for you to review. Built for students who find lectures harder to follow, this policy explains what data we collect, why, and how it is handled.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Data we collect</h2>
            <ul className="space-y-3 text-gray-400">
              <li><span className="text-white font-medium">Email address</span>: used only for authentication via a one-time code. We do not send marketing emails.</li>
              <li><span className="text-white font-medium">Audio recordings</span>: microphone audio is captured in short chunks, sent to Groq or OpenAI for transcription, and immediately discarded. We do not store audio files.</li>
              <li><span className="text-white font-medium">Transcripts</span>: for live microphone sessions we save a transcript only if you've declared a support need in your profile, or your lecturer has consented for your module. For recordings you upload or capture from an officially provided source, transcripts are saved to your account.</li>
              <li><span className="text-white font-medium">Term definitions</span>: to define a term we send the flagged term and a short excerpt of surrounding context to OpenAI. From the web app this is a single sentence per term, never full transcripts. Nothing sent for definitions is stored by us. If you&apos;ve set a translation language and your browser supports on-device translation (Chrome), the definition is translated on your device automatically. Otherwise, the same OpenAI request that generates the definition also translates it.</li>
              <li><span className="text-white font-medium">Detected terms</span>: the terms and definitions picked up from your sessions are stored in your account so you can review them later.</li>
              <li><span className="text-white font-medium">Profile information</span>: course, year of study, and date of birth. Used to tailor term explanations to your level and to keep the service age-appropriate. Date of birth is never shared.</li>
              <li><span className="text-white font-medium">Support need</span>: an optional, self-declared category (hearing, reading/dyslexia, focus/attention, language, or unspecified) used only to unlock full transcript saving without requiring lecturer consent each time. You choose whether to set this, can change it any time in your profile, and it is never shared or used for any other purpose.</li>
              <li><span className="text-white font-medium">Session data</span>: timestamps and duration of recording sessions. Used to calculate your streak and weekly stats.</li>
              <li><span className="text-white font-medium">Flashcard history</span>: your grading responses (Again / Hard / Good / Easy) used to schedule spaced repetition reviews.</li>
              <li><span className="text-white font-medium">Usage analytics</span>: anonymised events (e.g. &quot;recording started&quot;, &quot;flashcard graded&quot;) collected via PostHog to help us improve the product. No personal data is included in these events.</li>
              <li><span className="text-white font-medium">Pro waitlist</span>: if you join the waitlist we store your email and which feature prompted you, used only to contact you about Pro.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Third-party services</h2>
            <ul className="space-y-3 text-gray-400">
              <li><span className="text-white font-medium">Supabase</span>: database and authentication. Your data is stored in Supabase&apos;s EU infrastructure.</li>
              <li><span className="text-white font-medium">Groq &amp; OpenAI</span>: audio is transcribed using Groq&apos;s and/or OpenAI&apos;s APIs, and term detection uses OpenAI. Unless your browser supports on-device translation (Chrome), definition translation also uses OpenAI. Audio is processed in real time and not stored by us. These providers are based in the United States; data is transferred under their data processing agreements and standard contractual clauses, and is not used to train their models.</li>
              <li><span className="text-white font-medium">PostHog</span>: product analytics. Events are anonymised before being sent.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Data sharing</h2>
            <p className="text-gray-400">
              We do not sell, rent, or share your personal data with any third party outside of the services listed above.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Data retention and deletion</h2>
            <p className="text-gray-400">
              Your data is kept for as long as your account is active. You can delete your account and all associated data at any time by emailing us at the address below. We&apos;ll process deletion requests within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Cookies</h2>
            <p className="text-gray-400">
              We use a single session cookie to keep you logged in. No advertising or tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Contact</h2>
            <p className="text-gray-400">
              Questions about this policy or your data: <a href="mailto:privacy@demist.app" className="text-yellow-400 hover:text-yellow-300 transition-colors">privacy@demist.app</a>
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Complaints</h2>
            <p className="text-gray-400">
              If you have a concern about how we handle your data, email <a href="mailto:privacy@demist.app" className="text-yellow-400 hover:text-yellow-300 transition-colors">privacy@demist.app</a>. We&apos;ll acknowledge your complaint within 30 days. You also have the right to complain to the UK Information Commissioner&apos;s Office (<a href="https://ico.org.uk" className="text-yellow-400 hover:text-yellow-300 transition-colors">ico.org.uk</a>).
            </p>
          </section>

        </div>

        <div className="mt-16 pt-8 border-t border-white/[0.05]">
          <Link href="/" className="text-[13px] text-gray-600 hover:text-gray-400 transition-colors">
            ← Back to Demist
          </Link>
        </div>
      </div>
    </main>
  )
}
