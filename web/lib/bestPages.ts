// "Best lecture apps for ..." roundups at /best/<slug>.
//
// WHY. On 2026-11-27 growth/citations.mjs asked 36 student-style questions to
// a search-enabled assistant: "best X for Y" list pages were the most cited
// kind of page, and almost none named Demist. These pages answer those
// questions the way a fair list would, other tools first where they are the
// better pick, and say plainly that Demist is ours.
//
// RULES FOR EDITING THIS FILE:
// - Every fact about another product comes from that product's own pages,
//   listed in TOOL_SOURCES, read on the date in `checked`. If its page does
//   not say something, we do not say it either.
// - Demist's lines must match the code (lib/pricing.ts, lib/entitlementRules.ts)
//   and the /compare and /for pages.
// - Never mention the iPhone app here (product decision 2026-11-24).
// - Customer-facing copy: never the word "AI", never an em dash, no clinical claims.

import { PRO_PRICE_TEXT } from './pricing'

export interface Pick {
  tool: ToolId
  bestFor: string
  why: string
  watchOut: string
}

export interface BestPage {
  slug: string
  audience: string
  title: string
  description: string
  /** Quotable on its own: the short answer. */
  answer: string
  /** What matters when choosing, for this reader. */
  lookFor: string[]
  picks: Pick[]
  faq: { q: string; a: string }[]
}

export type ToolId = 'demist' | 'otter' | 'genio' | 'notability' | 'livecaptions' | 'livetranscribe' | 'support'

export const TOOLS: Record<ToolId, { name: string; price: string; runsOn: string; checked: string | null; sources: { label: string; url: string }[] }> = {
  demist: {
    name: 'Demist (ours)',
    price: `Free. Pro is ${PRO_PRICE_TEXT.monthly} a month or ${PRO_PRICE_TEXT.yearly} a year, and new accounts get Pro free for 14 days`,
    runsOn: 'Windows app (Mac in beta), or in the browser',
    checked: null,
    sources: [],
  },
  otter: {
    name: 'Otter',
    price: 'Free Basic plan. Pro is $16.99 a month, or $8.33 a month billed annually, with 20% off for students with a .edu email address',
    runsOn: 'Web, iOS and Android apps',
    checked: '2026-11-27',
    sources: [{ label: 'Otter pricing', url: 'https://otter.ai/pricing' }],
  },
  genio: {
    name: 'Genio Notes',
    price: 'Individual plans from £12 a month, with a 30-day free trial and no payment details needed. Also sold to departments and institutions',
    runsOn: 'Not covered here; see Genio\'s site',
    checked: '2026-11-26',
    sources: [
      { label: 'Genio pricing for individuals', url: 'https://genio.co/pricing/individuals' },
      { label: 'Genio Notes', url: 'https://genio.co/notes' },
      { label: 'Example: University of Wisconsin-Milwaukee provides Genio through its accessibility centre', url: 'https://uwm.edu/accessibility-resource-center/accommodations/academic/genio-notetaking-app/' },
    ],
  },
  notability: {
    name: 'Notability',
    price: 'Free Starter plan with 5 notes. Paid plans listed yearly, in US dollars, from $11.99 (Lite); transcription starts on Plus ($15.99) and is unlimited on Pro ($79.99). Prices on 27 November 2026 may include an offer',
    runsOn: 'Mac, Windows, iPad, iPhone and Android are listed on its site',
    checked: '2026-11-27',
    sources: [{ label: 'Notability pricing', url: 'https://notability.com/pricing' }],
  },
  livecaptions: {
    name: 'Windows Live Captions',
    price: 'Built into Windows 11. Microsoft\'s page does not mention a charge',
    runsOn: 'Windows 11, version 22H2 and later',
    checked: '2026-11-04',
    sources: [{ label: 'Microsoft Support: live captions', url: 'https://support.microsoft.com/en-us/windows/use-live-captions-to-better-understand-audio-b52da59c-14b8-4031-aeeb-f6a47e6055df' }],
  },
  livetranscribe: {
    name: 'Google Live Transcribe',
    price: 'Already installed on Pixel phones and some other Android phones',
    runsOn: 'Android',
    checked: '2026-11-27',
    sources: [{ label: 'Live Transcribe help', url: 'https://support.google.com/accessibility/android/answer/9158064' }],
  },
  support: {
    name: 'Your university\'s disability service',
    price: 'Free to students. In the UK, support can be funded through Disabled Students\' Allowance (DSA)',
    runsOn: 'In person, arranged through your university',
    checked: null,
    sources: [{ label: 'GOV.UK: Disabled Students\' Allowance', url: 'https://www.gov.uk/disabled-students-allowance-dsa' }],
  },
}

// Demist's own limits, said the same way on every page.
const DEMIST_LIMITS = 'The Windows app transcribes lectures in English and needs an internet connection to start. It is not a certified captioning service, and explanations are generated automatically, so they can be wrong. Full notes are 3 lectures a month on the free plan.'

export const BEST_PAGES_REVIEWED = '2026-11-27'

export const BEST_PAGES: BestPage[] = [
  {
    slug: 'lecture-apps-for-adhd',
    audience: 'students with ADHD',
    title: 'Best lecture apps for students with ADHD (2026)',
    description: 'An honest comparison of lecture apps for students with ADHD: live transcripts to catch up from, notes written for you, recordings to listen back to, and what each costs.',
    answer: 'If you lose the thread when your attention drifts, look for an app that keeps a live transcript you can glance back at, so a lapse does not cost you the rest of the lecture. Demist (ours) does that and explains unfamiliar words as they are said. Otter is a strong general transcriber, Genio Notes suits students who like to organise their own notes against the recording, and Notability suits handwritten notes on a tablet.',
    lookFor: [
      'A live transcript, so you can catch up after drifting without waiting for the recording.',
      'Notes written for you, so you are not splitting attention between listening and writing.',
      'A way to mark the moment you got lost and come back to it.',
      'Free limits that cover a whole lecture, not just a short clip.',
    ],
    picks: [
      { tool: 'demist', bestFor: 'Catching up during the lecture and revising after it', why: 'A live transcript keeps the last few minutes on screen, unfamiliar words are explained as they are said, and an I\'m lost button marks the moment you stopped following. Afterwards it writes full lecture notes and flashcards. In the Windows app with Pro, you can tap a sentence to hear that moment again.', watchOut: DEMIST_LIMITS },
      { tool: 'otter', bestFor: 'A full transcript of meetings and long recordings', why: 'Live transcription on its free plan, with speaker identification and apps for iOS and Android.', watchOut: 'The free plan caps each conversation at 30 minutes and 300 minutes a month, so most lectures need Pro. Explanations of terms and flashcards are not listed.' },
      { tool: 'genio', bestFor: 'Organising your own notes against the lecture audio', why: 'Notes are organised against the recording, with summaries linked to moments in it and multiple-choice Quiz Me questions. Many universities provide it through disability support.', watchOut: 'Transcripts are generated after class, and live captions are not available on individual plans.' },
      { tool: 'notability', bestFor: 'Handwritten notes on a tablet while recording', why: 'Records lectures while you take notes. Paid plans add transcription, summaries, quizzes and flashcards.', watchOut: 'Transcription is limited on Plus and unlimited only on Pro. The free plan is 5 notes.' },
    ],
    faq: [
      { q: 'What is the best lecture app for students with ADHD?', a: 'It depends on what goes wrong. If you lose the thread during lectures, an app with a live transcript you can read back, such as Demist (ours), helps you recover in the moment. If you prefer writing and organising your own notes against a recording, Genio Notes or Notability suit that better.' },
      { q: 'Is there a free lecture app for ADHD?', a: 'Demist is free, with unlimited recording in its Windows app and full notes for 3 lectures a month. Otter has a free plan, but it stops each recording at 30 minutes. Windows Live Captions is built into Windows 11 but does not keep anything.' },
      { q: 'Do I need a diagnosis to use these?', a: 'No. Any student can use them. A diagnosis can matter for getting support funded through your university or, in the UK, Disabled Students\' Allowance.' },
    ],
  },
  {
    slug: 'lecture-apps-for-dyslexia',
    audience: 'students with dyslexia',
    title: 'Best lecture apps for students with dyslexia (2026)',
    description: 'Lecture apps for dyslexic students compared: notes written for you, listening back, readable layouts and what each one costs.',
    answer: 'For dyslexic students the useful lecture apps are the ones that cut down on writing while listening and on reading long transcripts afterwards. Demist (ours) writes notes for you, explains difficult words as they are said and can read text aloud. Genio Notes suits students who want to build their own notes against the recording, and Notability suits handwriting on a tablet.',
    lookFor: [
      'Notes written for you, so you are not writing while listening.',
      'A way to listen back to one moment instead of a whole recording.',
      'Text you can make readable: font, spacing and read aloud.',
      'Plain explanations of new vocabulary.',
    ],
    picks: [
      { tool: 'demist', bestFor: 'Notes written for you, with difficult words explained', why: 'Writes the lecture down live, explains unfamiliar words on screen, and afterwards writes full notes in sections. You can change the font and line spacing and have text read aloud. In the Windows app with Pro, tap a sentence to hear that moment again.', watchOut: DEMIST_LIMITS },
      { tool: 'genio', bestFor: 'Building your own notes against the recording', why: 'Notes are organised against the lecture audio, with summaries linked to moments in it. Many universities provide it through their disability service.', watchOut: 'Transcripts come after class rather than live. Individual plans are from £12 a month.' },
      { tool: 'notability', bestFor: 'Handwriting with the recording alongside', why: 'Records lectures while you take notes, and paid plans add transcription and summaries.', watchOut: 'Transcription needs a paid plan, and is limited on Plus.' },
      { tool: 'otter', bestFor: 'A searchable transcript of everything', why: 'Live transcription with speaker identification on its free plan.', watchOut: 'Free recordings stop at 30 minutes. A full transcript is a lot of reading, and notes or explanations for students are not listed.' },
    ],
    faq: [
      { q: 'What is the best note-taking app for dyslexic students?', a: 'One that writes the notes for you and keeps the recording close by. Demist (ours) writes notes from a live transcript and explains difficult words; Genio Notes suits students who want to organise their own notes against the audio.' },
      { q: 'Can I get lecture software through DSA?', a: 'In the UK, a DSA needs assessment can recommend software and equipment, supplied through the student finance process. Ask your university\'s disability service what they recommend.' },
    ],
  },
  {
    slug: 'lecture-apps-for-deaf-students',
    audience: 'deaf and hard of hearing students',
    title: 'Best lecture captioning apps for deaf and hard of hearing students (2026)',
    description: 'Free and paid ways to follow lectures as a deaf or hard of hearing student: live captions, transcripts you can keep, and when to ask for human captioning.',
    answer: 'If you rely on captions to follow a lecture, start with your university\'s disability service: human captioners and note-takers are more accurate than any app. For everyday captions, Windows Live Captions is built into Windows 11 and Google Live Transcribe is on many Android phones, both free. Demist (ours) and Otter keep the transcript afterwards, and Demist also explains unfamiliar words as they appear.',
    lookFor: [
      'Accuracy you can rely on. Automatic captions make mistakes, especially with names and technical terms.',
      'Whether the transcript is kept, so you can check what you missed.',
      'Works with no internet, if your lecture rooms have poor signal.',
    ],
    picks: [
      { tool: 'support', bestFor: 'Accuracy when you depend on it', why: 'Human captioners, speech-to-text reporters and note-takers can be arranged through your university, and in the UK funded through DSA.', watchOut: 'Needs arranging in advance, so ask early in term.' },
      { tool: 'livecaptions', bestFor: 'Free captions on a Windows laptop, even offline', why: 'Captions any audio on screen, on your own device, and Microsoft says it works when disconnected from the internet.', watchOut: 'Captions are not stored anywhere, so nothing is left to revise from.' },
      { tool: 'livetranscribe', bestFor: 'Free captions on an Android phone', why: 'Already installed on Pixel and some other Android phones, with offline languages on many of them.', watchOut: 'Transcription history is kept for up to three days, then deleted.' },
      { tool: 'demist', bestFor: 'A kept transcript with new words explained', why: 'Shows a live transcript, explains unfamiliar terms on screen as they are said, and keeps the transcript with notes and a glossary to revise from.', watchOut: DEMIST_LIMITS },
      { tool: 'otter', bestFor: 'A kept transcript of meetings and seminars', why: 'Live transcription with speaker identification on its free plan.', watchOut: 'Free recordings stop at 30 minutes and 300 minutes a month.' },
    ],
    faq: [
      { q: 'Are lecture captioning apps accurate enough to rely on?', a: 'Not always. Automatic captions mishear names, numbers and technical words. If you depend on captions, ask your university for human captioning and use apps alongside it.' },
      { q: 'What free captioning can I use in lectures?', a: 'Windows Live Captions on Windows 11 and Google Live Transcribe on many Android phones are free. Demist is free to start and keeps the transcript afterwards.' },
    ],
  },
  {
    slug: 'lecture-apps-for-international-students',
    audience: 'international students',
    title: 'Best lecture apps for international students and English learners (2026)',
    description: 'Lecture apps compared for students whose first language is not English: live transcripts, explanations of difficult words, translation and price.',
    answer: 'If English is not your first language, the most useful lecture apps let you read what the lecturer says as they say it and explain difficult words in plain English. Demist (ours) does both and can translate the transcript and explanations into Mandarin, Arabic, Hindi, Spanish or French. Windows Live Captions is free and built in, and Otter keeps a transcript in several languages.',
    lookFor: [
      'A live transcript, so fast speech and accents are easier to follow.',
      'Plain explanations of subject vocabulary, not just a translation.',
      'Translation into your language when you need it.',
    ],
    picks: [
      { tool: 'demist', bestFor: 'Understanding difficult words while the lecturer talks', why: 'A live transcript, plain-English explanations of unfamiliar words as they are said, and translation of the transcript and explanations into Mandarin, Arabic, Hindi, Spanish or French. Afterwards it writes notes and flashcards.', watchOut: DEMIST_LIMITS },
      { tool: 'livecaptions', bestFor: 'Free live captions on Windows 11', why: 'Captions any audio on your own device, and lists 21 languages.', watchOut: 'Nothing is kept afterwards. Translation is only on Copilot+ PCs, into English or Chinese (Simplified).' },
      { tool: 'otter', bestFor: 'A kept transcript in several languages', why: 'Transcribes English, Spanish, French, German, Japanese and Chinese, with live transcription on the free plan.', watchOut: 'Free recordings stop at 30 minutes. Translation and explanations of terms are not listed.' },
    ],
    faq: [
      { q: 'Is there an app that translates lectures live?', a: 'Demist (ours) shows a live transcript and can translate it and its explanations into Mandarin, Arabic, Hindi, Spanish or French. Windows Live Captions translates into English or Chinese on Copilot+ PCs only.' },
      { q: 'What app explains difficult words in lectures?', a: 'Demist explains unfamiliar words on screen in plain English as the lecturer says them, and keeps them in a glossary with flashcards.' },
    ],
  },
]

export function getBestPage(slug: string): BestPage | undefined {
  return BEST_PAGES.find(p => p.slug === slug)
}
