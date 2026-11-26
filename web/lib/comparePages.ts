// Comparison pages at /compare/<slug>.
//
// WHY. "Otter alternative for lectures" and "NotebookLM vs ..." are the
// questions where AI assistants decide which tools to name, and they quote
// whatever page answers the question most plainly. These pages answer it,
// including where the other tool is the better choice: a comparison that
// only ever says "us" is one no assistant (or student) should trust.
//
// RULES FOR EDITING THIS FILE:
// - Every fact about another product comes from that product's own pricing
//   or help pages, listed in `sources`, and `checkedOn` is the day they were
//   read. If a page does not say something, the table says "Not listed",
//   never a guess in either direction.
// - Recheck before changing anything, and update checkedOn when you do.
// - Demist's own column must match the code: pricing from lib/pricing.ts,
//   limits from lib/entitlementRules.ts, languages from LANGUAGE_NAMES.

import { PRO_PRICE_TEXT } from './pricing'

export interface ComparePage {
  slug: string
  name: string
  title: string
  description: string
  /** One paragraph: who each tool suits. The answer an assistant should quote. */
  verdict: string
  rows: { label: string; demist: string; them: string }[]
  /** Where the other tool is honestly the better pick. */
  themBetter: string[]
  faq: { q: string; a: string }[]
  sources: { label: string; url: string }[]
  checkedOn: string
}

const DEMIST_PRICE = `Free. Pro is ${PRO_PRICE_TEXT.monthly} a month or ${PRO_PRICE_TEXT.yearly} a year, and new accounts get Pro free for 14 days`
const DEMIST_AUDIO = 'Windows app: on your own computer for live lectures. iPhone app: speech recognised on the phone, words to explain sent to Demist\'s server. Browser version and uploads: on Demist\'s server'
const DEMIST_TRANSLATION = 'Explanations can be translated into Mandarin, Arabic, Hindi, Spanish or French'
const DEMIST_FLASHCARDS = 'Yes, built automatically from each lecture, with spaced repetition. Anki export on Pro'
const DEMIST_LIVE = 'Yes: unfamiliar terms are explained on screen while the lecturer is still talking'

export const COMPARE_PAGES: ComparePage[] = [
  {
    slug: 'otter',
    name: 'Otter',
    title: 'Demist vs Otter for university lectures',
    description:
      'How Demist and Otter compare for students recording lectures: live term explanations, flashcards, translation, pricing and where your audio is processed.',
    verdict:
      'Otter is a general transcription and meeting-notes tool: strong at recording, transcribing and sharing conversations. Demist is built for one situation, a student in a lecture who meets vocabulary they do not know yet, and explains those terms while the lecture is happening, then turns them into flashcards. If you want a transcript of everything, Otter suits you. If you want to understand the lecture as it happens, Demist does.',
    rows: [
      { label: 'Price for students', demist: DEMIST_PRICE, them: 'Free Basic plan. Pro is $16.99 a month, or $8.33 a month billed annually. 20% off Pro for students with a .edu email address' },
      { label: 'Free plan limits', demist: 'Unlimited recording in the Windows and iPhone apps; 3 recordings in the browser. 7 days of lecture history', them: '300 transcription minutes a month, 30 minutes per conversation, 3 lifetime file imports' },
      { label: 'Live transcription', demist: 'Yes', them: 'Yes' },
      { label: 'Explains terms during the lecture', demist: DEMIST_LIVE, them: 'Not listed' },
      { label: 'Translation', demist: DEMIST_TRANSLATION, them: 'Not listed on its pricing page' },
      { label: 'Flashcards', demist: DEMIST_FLASHCARDS, them: 'Not listed' },
      { label: 'Where audio is processed', demist: DEMIST_AUDIO, them: 'Not stated on its pricing page' },
    ],
    themBetter: [
      'You mainly need a full, shareable transcript of meetings or long recordings.',
      'You work in a team that shares notes and recordings in one place.',
    ],
    faq: [
      { q: 'Is Demist an Otter alternative for lectures?', a: 'For lectures, yes, with a different focus. Otter gives you a transcript; Demist explains unfamiliar terms while the lecturer is talking and builds flashcards from them afterwards. Some students use both.' },
      { q: 'Which is cheaper for students?', a: `Both have free plans. Demist Pro is ${PRO_PRICE_TEXT.monthly} a month or ${PRO_PRICE_TEXT.yearly} a year. Otter Pro is listed at $16.99 a month or $8.33 a month billed annually, with 20% off for students with a .edu email.` },
      { q: 'Does either work with recorded lectures?', a: 'Both accept uploaded recordings. Demist can also listen to a lecture recording playing in a browser tab, such as Panopto or Teams, so you can pause and rewind as it explains.' },
    ],
    sources: [{ label: 'Otter pricing', url: 'https://otter.ai/pricing' }],
    checkedOn: '2026-09-25',
  },
  {
    slug: 'genio',
    name: 'Genio Notes',
    title: 'Demist vs Genio Notes for university lectures',
    description:
      'How Demist and Genio Notes compare for students: lecture notes, live transcripts and term explanations, listening back, quizzes and flashcards, translation and pricing.',
    verdict:
      'Both record a lecture and give you notes afterwards. Genio Notes is built around organising your own notes against the recording, with transcripts made after class. Demist works during the lecture as well: it writes the lecture down live and explains unfamiliar terms on screen as they are said, then writes full notes from the transcript and builds flashcards. If you want to write and arrange your own notes against the audio, Genio suits you. If you lose the thread in the lecture itself, or want the notes written for you, Demist does. Demist is free to start; Genio individual plans are from £12 a month.',
    rows: [
      { label: 'Price for students', demist: DEMIST_PRICE, them: 'Individual plans from £12 a month, with a 30-day free trial and no payment details needed. Also sold to departments and institutions' },
      { label: 'Notes written for you', demist: 'Full lecture notes from the transcript, in sections with headings. Deadlines and exam hints quoted in the lecturer\'s words. 3 lectures a month free, every lecture on Pro', them: 'Structured summaries linked to moments in the recording, at the click of a button' },
      { label: 'Listen back', demist: 'Windows app with Pro: the audio is kept on your computer, and tapping a sentence plays that moment', them: 'Yes, notes are organised against the lecture recording' },
      { label: 'Transcripts', demist: 'Live, as the lecture happens', them: 'Generated after class' },
      { label: 'Live captions', demist: 'The live transcript is shown as the lecturer speaks', them: 'Not available on individual plans' },
      { label: 'Explains terms during the lecture', demist: DEMIST_LIVE, them: 'Not listed' },
      { label: 'Translation', demist: DEMIST_TRANSLATION, them: 'Transcription in multiple languages; translation not listed' },
      { label: 'Quizzes and flashcards', demist: DEMIST_FLASHCARDS, them: 'Multiple-choice "Quiz Me" questions from a recorded class. Flashcards not listed' },
      { label: 'Where audio is processed', demist: DEMIST_AUDIO, them: 'Not stated on its pricing pages' },
    ],
    themBetter: [
      'You want to write and organise your own notes against the lecture audio.',
      'Your university or disability support already gives you a Genio licence.',
      'You take handwritten notes and want them kept with the recording.',
    ],
    faq: [
      { q: 'Is Demist a Genio alternative?', a: 'For many students, yes. Both record your lecture and give you notes afterwards. The difference is during the lecture: Demist shows a live transcript and explains unfamiliar terms as they are said, then writes the notes for you, where Genio is built around organising notes yourself against the recording. Demist is free to start, with Pro at ' + PRO_PRICE_TEXT.yearly + ' a year; Genio individual plans are from £12 a month.' },
      { q: 'Can I use Demist and Genio together?', a: 'Yes. Some students keep Genio for their own notes against the recording and use Demist for explanations of unfamiliar terms while the lecture is happening.' },
      { q: 'Which is cheaper?', a: `Demist is free, with Pro at ${PRO_PRICE_TEXT.monthly} a month or ${PRO_PRICE_TEXT.yearly} a year. Genio lists individual plans from £12 a month, and also sells licences to departments and institutions.` },
      { q: 'Does Demist give live captions?', a: 'Demist shows a live transcript as the lecturer speaks. It is built for following a lecture, not as a certified captioning service.' },
    ],
    sources: [
      { label: 'Genio pricing for individuals', url: 'https://genio.co/pricing/individuals' },
      { label: 'Genio pricing', url: 'https://genio.co/pricing' },
      { label: 'Genio Notes', url: 'https://genio.co/notes' },
    ],
    checkedOn: '2026-11-26',
  },
  {
    slug: 'notebooklm',
    name: 'NotebookLM (Gemini Notebook)',
    title: 'Demist vs NotebookLM (Gemini Notebook) for students',
    description:
      'How Demist and NotebookLM, now called Gemini Notebook, compare for students: explanations during the lecture versus studying from your sources afterwards, flashcards, pricing and limits.',
    verdict:
      'NotebookLM, now called Gemini Notebook, is a free study tool that works from sources you give it, such as PDFs, websites, YouTube videos and audio, including lectures recorded with its mobile app. It turns them into audio and video overviews, quizzes and flashcards. Demist works while the lecture is happening: it listens live and explains unfamiliar terms as they are said. They fit together: Demist to follow the lecture, Gemini Notebook to study from it and your readings afterwards.',
    rows: [
      { label: 'Price for students', demist: DEMIST_PRICE, them: 'Free, with daily limits. Some students can claim a free Google subscription for higher limits, until 31 December 2026' },
      { label: 'Free plan limits', demist: 'Unlimited recording in the Windows and iPhone apps; 3 recordings in the browser. 7 days of lecture history', them: 'Up to 100 notebooks of up to 50 sources each, 50 chat queries a day, and up to 10 quizzes or flashcard sets a day' },
      { label: 'Explains terms during the lecture', demist: DEMIST_LIVE, them: 'Not described. Its mobile app can record a lecture to use as a source afterwards' },
      { label: 'What it works from', demist: 'A live lecture (microphone, a browser tab, or system audio in the Windows app), or an uploaded recording, slides or transcript', them: 'PDFs, websites, YouTube videos, audio files, Google Docs and Google Slides' },
      { label: 'Flashcards and quizzes', demist: DEMIST_FLASHCARDS, them: 'Yes, generated from your sources, with adjustable topic, difficulty and number' },
      { label: 'Overviews', demist: 'Full written notes from each lecture\'s transcript', them: 'Audio overviews and short video overviews of your sources' },
      { label: 'Where audio is processed', demist: DEMIST_AUDIO, them: 'Not stated on the pages checked' },
    ],
    themBetter: [
      'You are studying from readings, papers and slides rather than a live lecture.',
      'You want to ask questions across many sources at once.',
      'You want audio or video overviews of your material.',
    ],
    faq: [
      { q: 'Is NotebookLM the same as Gemini Notebook?', a: 'Yes. Google has renamed NotebookLM to Gemini Notebook.' },
      { q: 'Can Gemini Notebook explain a lecture while it is happening?', a: 'Its mobile app can record a lecture so you can study from it afterwards. Explaining terms live, while the lecturer is talking, is what Demist is built for.' },
      { q: 'Should I use both?', a: 'They work well together: Demist during the lecture, so you do not lose the thread, and Gemini Notebook afterwards, to study from the lecture and your readings.' },
    ],
    sources: [
      { label: 'Google for Education: Gemini Notebook', url: 'https://edu.google.com/intl/ALL_us/ai-gemini-notebook/' },
      { label: 'Google blog: new Gemini Notebook study tools, September 2026', url: 'https://blog.google/innovation-and-ai/products/gemini-notebook/new-study-tools-september-2026/' },
      { label: 'Gemini Notebook help: adding sources', url: 'https://support.google.com/notebooklm/answer/16164461' },
      { label: 'Gemini Notebook help: flashcards and quizzes', url: 'https://support.google.com/gemininotebook/answer/16958963?hl=en' },
    ],
    checkedOn: '2026-09-25',
  },
  {
    slug: 'windows-live-captions',
    name: 'Windows Live Captions',
    title: 'Demist vs Windows Live Captions for university lectures',
    description:
      'How Demist and the Live Captions built into Windows 11 compare for lectures: saved transcripts, explanations of unfamiliar words, flashcards, translation and offline use.',
    verdict:
      'Live Captions is built into Windows 11 and puts captions on screen for any audio, on your own device, even with no internet connection, but it does not keep them. Demist is for learning from a lecture: it keeps the transcript, explains unfamiliar words while the lecturer is talking, and builds a glossary and flashcards. If you only need captions in the moment, Live Captions may be all you need. If you want something to go back to and revise from, Demist does that.',
    rows: [
      { label: 'Price for students', demist: DEMIST_PRICE, them: 'Built into Windows 11. Microsoft\'s page does not mention a charge' },
      { label: 'Where it runs', demist: 'Windows app, iPhone app, and in the browser', them: 'Windows 11, version 22H2 and later' },
      { label: 'Live text on screen', demist: 'Yes', them: 'Yes' },
      { label: 'Keeps a transcript afterwards', demist: 'Yes, with lecture notes and a glossary', them: 'No. Microsoft says generated captions are not stored anywhere on the device or the cloud' },
      { label: 'Explains terms during the lecture', demist: DEMIST_LIVE, them: 'Not listed' },
      { label: 'Flashcards', demist: DEMIST_FLASHCARDS, them: 'Not listed' },
      { label: 'Translation', demist: 'The transcript and explanations can be translated into Mandarin, Arabic, Hindi, Spanish or French', them: 'On Copilot+ PCs only, into English or Chinese (Simplified)' },
      { label: 'Languages it can transcribe', demist: 'Windows app: lectures in English. The browser version handles other languages too', them: '21 languages listed' },
      { label: 'Works with no internet', demist: 'No. The Windows app needs a connection to start', them: 'Yes, Microsoft says captions can be provided when disconnected from the internet' },
      { label: 'Where audio is processed', demist: DEMIST_AUDIO, them: 'On your device, according to Microsoft' },
    ],
    themBetter: [
      'You only need captions in the moment, and do not want to keep anything.',
      'You want captions over any app with nothing to install and no account.',
      'You have no reliable internet connection.',
      'Your lectures are in a language other than English and you want everything on your own device.',
    ],
    faq: [
      { q: 'Is Windows Live Captions enough for lectures?', a: 'It depends what you need. For captions on screen in the moment, it may well be. It does not keep the captions, so it will not give you a transcript, a glossary or anything to revise from, and it does not explain unfamiliar words. Demist does those things.' },
      { q: 'Can I use both?', a: 'Yes. They do different jobs, and nothing stops you having captions on screen while Demist builds your notes.' },
      { q: 'Which is more private?', a: 'Both process live audio on your own computer: Live Captions always, and Demist in its Windows app. The browser version of Demist sends audio to Demist\'s server to be transcribed.' },
    ],
    sources: [{ label: 'Microsoft Support: Use live captions to better understand audio', url: 'https://support.microsoft.com/en-us/windows/use-live-captions-to-better-understand-audio-b52da59c-14b8-4031-aeeb-f6a47e6055df' }],
    checkedOn: '2026-11-04',
  },
]

export function getComparePage(slug: string): ComparePage | undefined {
  return COMPARE_PAGES.find(p => p.slug === slug)
}
