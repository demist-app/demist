import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  robots: { index: true, follow: true },
}

export default function Privacy() {
  const updated = '24 May 2025'

  return (
    <main className="min-h-dvh bg-[#080810] text-white px-6 py-16">
      <div className="max-w-[680px] mx-auto">
        <Link href="/" className="text-[11px] font-bold tracking-[0.2em] text-violet-400/70 uppercase hover:text-violet-400 transition-colors">
          ← Demist
        </Link>

        <h1 className="text-[34px] font-bold tracking-tight mt-8 mb-2">Privacy Policy</h1>
        <p className="text-gray-600 text-[14px] mb-12">Last updated {updated}</p>

        <div className="space-y-10 text-[15px] leading-relaxed">

          <section>
            <h2 className="text-[17px] font-semibold mb-3">What Demist does</h2>
            <p className="text-gray-400">
              Demist is a study tool that listens to your lectures, detects unfamiliar terminology, and builds a personal glossary for you to review. This policy explains what data we collect, why, and how it is handled.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Data we collect</h2>
            <ul className="space-y-3 text-gray-400">
              <li><span className="text-white font-medium">Email address</span> — used only for authentication via a one-time code. We do not send marketing emails.</li>
              <li><span className="text-white font-medium">Audio recordings</span> — microphone audio is captured in 10-second chunks, sent to OpenAI&apos;s Whisper API for transcription, and immediately discarded. We do not store any audio files.</li>
              <li><span className="text-white font-medium">Detected terms</span> — terms and their definitions extracted from transcripts are stored in your account so you can review them later.</li>
              <li><span className="text-white font-medium">Profile information</span> — display name, course, year of study. All optional. Used to personalise term explanations.</li>
              <li><span className="text-white font-medium">Session data</span> — timestamps and duration of recording sessions. Used to calculate your streak and weekly stats.</li>
              <li><span className="text-white font-medium">Flashcard history</span> — your grading responses (Again / Hard / Good / Easy) used to schedule spaced repetition reviews.</li>
              <li><span className="text-white font-medium">Usage analytics</span> — anonymised events (e.g. &quot;recording started&quot;, &quot;flashcard graded&quot;) collected via PostHog to help us improve the product. No personal data is included in these events.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Third-party services</h2>
            <ul className="space-y-3 text-gray-400">
              <li><span className="text-white font-medium">Supabase</span> — database and authentication. Your data is stored in Supabase&apos;s EU infrastructure.</li>
              <li><span className="text-white font-medium">OpenAI</span> — audio transcription (Whisper) and term detection (GPT-4o mini). Audio and transcripts are processed under OpenAI&apos;s API data usage policy and are not used to train their models.</li>
              <li><span className="text-white font-medium">PostHog</span> — product analytics. Events are anonymised before being sent.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Data sharing</h2>
            <p className="text-gray-400">
              We do not sell, rent, or share your personal data with any third party outside of the services listed above. If you enable your public profile, your display name and term counts are visible to anyone with your profile link.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Data retention and deletion</h2>
            <p className="text-gray-400">
              Your data is kept for as long as your account is active. You can delete your account and all associated data at any time by contacting us at the email below. We will process deletion requests within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Cookies</h2>
            <p className="text-gray-400">
              We use a single session cookie to keep you logged in. No advertising or tracking cookies are used.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Contact</h2>
            <p className="text-gray-400">
              Questions about this policy or your data: <a href="mailto:shiv.chop0301@gmail.com" className="text-violet-400 hover:text-violet-300 transition-colors">shiv.chop0301@gmail.com</a>
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
