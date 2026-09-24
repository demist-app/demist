import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://demist.app/privacy' },
}

export default function Privacy() {
  const updated = '24 September 2026'

  return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 px-6 py-16">
      <div className="max-w-[680px] mx-auto">
        <Link href="/" className="text-[11px] font-bold tracking-[0.2em] dark:text-yellow-400/70 text-yellow-700 uppercase dark:hover:text-yellow-400 hover:text-yellow-600 transition-colors">
          ← Demist
        </Link>

        <h1 className="text-[34px] font-bold tracking-tight mt-8 mb-2">Privacy Policy</h1>
        <p className="dark:text-gray-600 text-gray-500 text-[14px] mb-12">Last updated {updated}</p>

        <div className="space-y-10 text-[15px] leading-relaxed">

          <section>
            <h2 className="text-[17px] font-semibold mb-3">What Demist does</h2>
            <p className="dark:text-gray-400 text-gray-700">
              Demist transcribes your lectures, reads them back, and explains and translates unfamiliar terminology in real time, building a personal glossary for you to review. Built for students who find lectures harder to follow, this policy explains what data we collect, why, and how it is handled.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Using Demist without an account</h2>
            <p className="dark:text-gray-400 text-gray-700">
              In the Windows desktop app you can choose <span className="dark:text-white text-gray-900 font-medium">Start without an account</span>. We then create an anonymous account that has no email address and no name attached to it. Your glossary, flashcards and session history are stored against that anonymous account so the app works normally. Because there is no email address on it, there is no way for us, or for you, to recover it if this device&apos;s storage is cleared or the app is reinstalled. You can add an email later in Settings to make it recoverable; doing so upgrades the same account rather than creating a new one.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Data we collect</h2>
            <ul className="space-y-3 dark:text-gray-400 text-gray-700">
              <li><span className="dark:text-white text-gray-900 font-medium">Email address</span>: used for authentication via a one-time code, to contact you if you join the Pro waitlist, and to tell you before a free Pro trial or free month of Pro ends and on the day it does. We do not send marketing emails. On the desktop app an email is optional, as described above.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Audio recordings</span>: in the web app, microphone audio is captured in short chunks, sent to Groq or OpenAI for transcription, and immediately discarded. In the desktop app audio never leaves your device at all, as set out in the desktop section below. We do not store audio files in either case.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Transcripts</span>: for live microphone sessions we save a transcript only if you&apos;ve declared a support need in your profile, or your lecturer has consented for your module. For recordings you upload or capture from an officially provided source, transcripts are saved to your account.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Term definitions</span>: in the web app, to define a term we send the flagged term and a short excerpt of surrounding context to OpenAI: a single sentence per term, never full transcripts. Nothing sent for definitions is stored by us. In the desktop app definitions are generated on your device and nothing is sent. If you&apos;ve set a translation language and your browser supports on-device translation (Chrome), the definition is translated on your device automatically; otherwise the same OpenAI request that generates the definition also translates it.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Detected terms</span>: the terms and definitions picked up from your sessions are stored in your account so you can review them later.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Profile information</span>: course, year of study, and date of birth. Course and year of study are used to tailor term explanations to your level. Date of birth is used only to check that you meet the minimum age of 16 set out in our Terms. It is never shared and is not used for anything else.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Support need</span>: an optional, self-declared category (hearing, reading/dyslexia, focus/attention, language, none of these, or unspecified) used only to unlock full transcript saving without requiring lecturer consent each time. Choosing &quot;none of these&quot; means microphone transcripts are saved only where your lecturer has consented for the module, which is the stricter setting. You choose whether to set this, can change it any time in your profile, and it is never shared or used for any other purpose.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Session data</span>: timestamps and duration of recording sessions. Used to calculate your streak and weekly stats.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Flashcard history</span>: your grading responses (Again / Hard / Good / Easy) used to schedule spaced repetition reviews.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Survey answers</span>: if you answer the short in-app survey (shown once, after a few lectures), your answers are stored in our own database against your account. Only the multiple-choice answers are sent to PostHog; anything you type stays in our database.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Usage analytics</span>: product events (e.g. &quot;recording started&quot;, &quot;flashcard graded&quot;) collected via PostHog to help us improve Demist. Once you sign in these events are linked to your account&apos;s user ID, so they are pseudonymous rather than anonymous: we can tell one person&apos;s activity apart from another&apos;s, but the events themselves carry no email, name, transcript text or term content. PostHog also automatically records unhandled errors, which may include technical details of what the app was doing when something went wrong.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Session replay</span>: on the <span className="dark:text-white text-gray-900 font-medium">web app only</span>, PostHog records how you move through a page: clicks, scrolling, navigation between pages, and where things go wrong (for example a button pressed repeatedly because nothing happened). <span className="dark:text-white text-gray-900 font-medium">All on-screen text is masked before anything leaves your browser</span>, so transcripts, term definitions, and anything you type are never captured as readable text. A replay shows the shape of a page and what was clicked, not what it said. This is used to find places people get stuck, such as steps in the flashcard review flow. It is never enabled in the desktop app, on any screen.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Subscription and payment</span>: if you subscribe to Demist Pro, Stripe handles the payment. <span className="dark:text-white text-gray-900 font-medium">We never see or store your card details</span>: they are entered directly into Stripe&apos;s own payment form and go straight to Stripe. We store only what is needed to know what you have access to, namely your Stripe customer and subscription identifiers, the plan, and the date your current period ends. Your email address is shared with Stripe so it can send receipts and manage the subscription.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Pro waitlist</span>: if you join the waitlist we store your email, which part of the product prompted you, and whether you have confirmed the address. Joining sends you a confirmation link, and we only treat you as being on the list once you click it. We store a one-way hash of that link&apos;s token, never the token itself. This is used only to contact you about Pro, once, when it is ready. You can join without an account.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Third-party services</h2>
            <ul className="space-y-3 dark:text-gray-400 text-gray-700">
              <li><span className="dark:text-white text-gray-900 font-medium">Supabase</span>: database and authentication.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Groq &amp; OpenAI</span>: used by the <span className="dark:text-white text-gray-900 font-medium">web app only</span>. Audio is transcribed using Groq&apos;s and/or OpenAI&apos;s APIs, and term detection uses OpenAI. Unless your browser supports on-device translation (Chrome), definition translation also uses OpenAI. Audio is processed in real time and not stored by us. These providers are based in the United States; data is transferred under their data processing agreements and standard contractual clauses, and is not used to train their models.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">PostHog</span>: product analytics, as described above.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Stripe</span>: payment processing for Demist Pro. Stripe receives your email address and the card details you enter into its own form, and is the only party that sees those details. Stripe is based in the United States and is PCI DSS Level 1 certified; data is transferred under its data processing agreement and standard contractual clauses. If you do not subscribe, nothing is sent to Stripe.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Resend</span>: sends the emails Demist has to send you, which is your sign-in code, the Pro waitlist confirmation if you joined it, and notices that a free Pro trial or free month of Pro is ending. Resend receives your email address and the contents of that email, nothing else.</li>
              <li><span className="dark:text-white text-gray-900 font-medium">Hugging Face</span>: the desktop app&apos;s transcription models are bundled in the app, so they are not normally fetched at all. If that bundle is ever missing from an install, the app falls back to downloading them from Hugging Face rather than failing outright. Its term-detection and translation models are downloaded from Hugging Face the first time they are needed and cached on your computer. These are ordinary file downloads. No lecture audio, transcript or personal data is sent, and nothing is uploaded.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Desktop app (on-device processing)</h2>
            <p className="dark:text-gray-400 text-gray-700 mb-3">
              If you use the Demist desktop app (Windows), transcription, translation, and term detection all run locally on your device using open-source models. Your lecture audio and the text derived from it are never sent to Groq, OpenAI, or any other third party for processing while using the desktop app. This covers every route text can take through the app, not only live recording: files you import, slides and transcripts you upload, and looking up a phrase you have selected are all processed by the same local models.
            </p>
            <p className="dark:text-gray-400 text-gray-700 mb-3">
              The transcription models ship inside the app itself, so transcription works on first launch with no download and no internet connection. The term-detection and translation models are larger and are downloaded from Hugging Face the first time they are needed, then cached on your computer; until that finishes you get transcription without term cards, rather than nothing. The app uses Whisper (MIT licensed), OPUS-MT translation models (Apache 2.0), Qwen (Apache 2.0) and Meta&apos;s Llama models (Llama Community License); license and attribution details ship with the app.
            </p>
            <p className="dark:text-gray-400 text-gray-700">
              This changes how data is processed, not whether it&apos;s stored: the same consent rules above still apply to saving a microphone-mode transcript, and detected terms, session timestamps, and flashcard history are still synced to our Supabase database exactly as in the web app, so your glossary and progress stay available across devices. The desktop app also loads its interface from demist.app, so it needs a connection to start.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Data sharing</h2>
            <p className="dark:text-gray-400 text-gray-700">
              We do not sell, rent, or share your personal data with any third party outside of the services listed above.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Data retention and deletion</h2>
            <p className="dark:text-gray-400 text-gray-700">
              Your data is kept for as long as your account is active. You can delete your account and everything stored against it (profile, transcripts, detected terms, sessions and flashcard history) at any time and without asking us, from <span className="dark:text-white text-gray-900 font-medium">Settings → Delete account</span>. This takes effect immediately and cannot be undone. If you would rather we did it, or you can no longer sign in, email the address below and we&apos;ll process the request within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Cookies</h2>
            <p className="dark:text-gray-400 text-gray-700">
              We use a session cookie to keep you signed in, and PostHog sets its own cookie so that your product events can be recognised as coming from the same browser between visits. We do not use advertising cookies, and we do not sell or share any of this with advertisers.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Contact</h2>
            <p className="dark:text-gray-400 text-gray-700">
              Questions about this policy or your data: <a href="mailto:privacy@demist.app" className="dark:text-yellow-400 text-yellow-700 dark:hover:text-yellow-300 hover:text-yellow-600 transition-colors">privacy@demist.app</a>
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold mb-3">Complaints</h2>
            <p className="dark:text-gray-400 text-gray-700">
              If you have a concern about how we handle your data, email <a href="mailto:privacy@demist.app" className="dark:text-yellow-400 text-yellow-700 dark:hover:text-yellow-300 hover:text-yellow-600 transition-colors">privacy@demist.app</a>. We&apos;ll acknowledge your complaint within 30 days. You also have the right to complain to the UK Information Commissioner&apos;s Office (<a href="https://ico.org.uk" className="dark:text-yellow-400 text-yellow-700 dark:hover:text-yellow-300 hover:text-yellow-600 transition-colors">ico.org.uk</a>).
            </p>
          </section>

        </div>

        <div className="mt-16 pt-8 border-t dark:border-white/[0.05] border-black/[0.08]">
          <Link href="/" className="text-[13px] dark:text-gray-600 text-gray-500 dark:hover:text-gray-400 hover:text-gray-700 transition-colors">
            ← Back to Demist
          </Link>
        </div>
      </div>
    </main>
  )
}
