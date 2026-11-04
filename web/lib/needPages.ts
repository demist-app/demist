// Need landing pages, at /for/<slug> beside the subject pages.
//
// WHY THESE EXIST. In the 30 days to 2026-11-04, 91 of 131 sign-ups said they
// found Demist through an AI assistant, and those people mostly chose
// attention (34), language (23) or hearing (19) as their reason. Nobody asks
// an assistant for "a nursing tool" as often as for "something that helps
// with my ADHD in lectures", yet every page here was organised by subject.
// `answer` is written to be quoted on its own: it names the need and says what
// Demist does in the first sentence.
//
// RULES FOR EDITING THIS FILE:
// - Everything here must be true of the product as it ships. Each feature
//   named below was checked against the code on 2026-11-04: read aloud
//   (components/ReadAloudButton), fonts, spacing, tints, greyscale and streaks
//   (lib/comfortPrefs), I'm lost (components/LostMoments), vocabulary cards
//   (lib/vocabulary, Windows app only, for people who said English is not
//   their first language).
// - No clinical or research claims: say what the product does, never that it
//   treats, improves or is proven to help anything. The evidence is not there,
//   and these are the readers it would matter most to mislead.
// - `notFor` is not optional. Saying where Demist is the wrong tool is what
//   makes the rest of the page worth quoting, and for a Deaf student relying
//   on it, the honest limits are the most useful thing here.
// - Customer-facing copy: never the word "AI", never an em dash.

export interface NeedPage {
  slug: string
  /** How the reader would describe themselves, e.g. "students with ADHD". */
  audience: string
  title: string
  description: string
  /** Two or three sentences that answer the question on their own. */
  answer: string
  helps: { heading: string; body: string }[]
  notFor: string[]
  faq: { q: string; a: string }[]
}

// The day these pages were last checked against the product. Shown on the page.
export const NEED_PAGES_REVIEWED = '2026-11-04'

export const NEED_PAGES: NeedPage[] = [
  {
    slug: 'adhd',
    audience: 'students with ADHD',
    title: 'A lecture app for students with ADHD',
    description:
      'Demist keeps a live transcript of your lecture, explains unfamiliar words as they are said, and lets you mark the moment you got lost, so a lapse in attention does not cost you the rest of the lecture. Free on Windows.',
    answer:
      'Demist is a lecture app for students who lose the thread when attention drifts, including students with ADHD. It writes the lecture down as it happens and explains unfamiliar words on screen, so when you come back you can read what you missed instead of being left behind. One tap on I\'m lost marks the moment, and afterwards Demist shows you what was said around it.',
    helps: [
      {
        heading: 'Catching up after your attention drifts',
        body: 'The live transcript means the last few minutes are always on screen. You can glance back, pick up the thread and keep going, without asking anyone or waiting for the recording.',
      },
      {
        heading: 'I\'m lost',
        body: 'Press it when you stop following. Nothing stops and nobody can see it. After the lecture, Demist shows what was said around each moment you marked, so you know exactly what to go back to.',
      },
      {
        heading: 'No writing while listening',
        body: 'Demist keeps the transcript and builds the glossary, so you are not splitting your attention between the lecturer and your notes. Afterwards you have a summary, and flashcards that bring words back shortly before you would forget them.',
      },
      {
        heading: 'A calmer screen',
        body: 'You can turn the whole app to greyscale, change the font and add line spacing. Day streaks are off unless you choose them, because for many people a broken streak is pressure, not motivation.',
      },
    ],
    notFor: [
      'Demist helps with following a lecture and revising it. It is not a task manager, a focus timer or a treatment for ADHD.',
      'Your university may have its own rules on recording lectures, so check them first.',
    ],
    faq: [
      { q: 'What is the best lecture app for students with ADHD?', a: 'It depends on what goes wrong for you. If you lose the thread in lectures, Demist is built for that: a live transcript to catch up from, explanations of unfamiliar words as they are said, and an I\'m lost button that marks the moment so you can go back to it. If you mainly need help starting work or planning your week, a task tool will suit you better.' },
      { q: 'Can Demist help if I zone out in a lecture?', a: 'It lets you recover. The transcript keeps running while your attention is elsewhere, so you can read back over what you missed, and pressing I\'m lost marks the moment to look at afterwards.' },
      { q: 'Do I need a diagnosis to use it?', a: 'No. Anyone can use Demist, and it does not ask for evidence of anything.' },
      { q: 'Is it free?', a: 'The core of it is. Live explanations, your glossary and flashcards are free, and recording is free and unlimited in the Windows app.' },
    ],
  },
  {
    slug: 'deaf-and-hard-of-hearing',
    audience: 'deaf and hard of hearing students',
    title: 'Live lecture transcription for deaf and hard of hearing students',
    description:
      'Demist turns a lecture into live text on your screen, explains unfamiliar words as they appear, and keeps the transcript afterwards. Free on Windows, where live lecture audio stays on your own computer.',
    answer:
      'Demist gives deaf and hard of hearing students live text of a lecture on their own laptop, keeps it afterwards as a transcript, and explains unfamiliar words as they come up. It works from a microphone in the room, or directly from the sound of an online lecture on your computer, which is usually clearer. It is automatic transcription, so it makes mistakes, and it does not replace a human notetaker or speech-to-text reporter where you need every word.',
    helps: [
      {
        heading: 'Live text you control',
        body: 'The transcript appears on your own screen, at the text size you choose, with no need to arrange anything with the lecturer first.',
      },
      {
        heading: 'Online lectures, straight from the source',
        body: 'For a lecture on Teams, Zoom or Panopto, Demist can listen to the computer\'s own audio instead of a microphone. That avoids the distance and room noise that make a microphone less accurate.',
      },
      {
        heading: 'A transcript to keep',
        body: 'When the lecture ends you have the full text, a summary, and a glossary of the words that came up, so you can check anything you were unsure of.',
      },
      {
        heading: 'Unfamiliar words explained',
        body: 'A technical word is harder to catch when you are reading it for the first time. Demist puts a short explanation on screen, and it can be read aloud or translated.',
      },
    ],
    notFor: [
      'Automatic transcription mishears words, especially names, technical terms and quiet or distant speakers, and the text appears a few seconds behind the speaker. If you need every word to be right, ask your university about a human notetaker or speech-to-text reporter.',
      'In a large lecture hall a laptop microphone may be too far from the lecturer to work well. Sitting near the front helps, and a lecture recording will give better results.',
      'Demist does not identify who is speaking, so it suits lectures better than seminars and group discussion.',
      'Demist is not a DSA approved supplier.',
    ],
    faq: [
      { q: 'What is the best live transcription app for deaf students in lectures?', a: 'For keeping a transcript and understanding new vocabulary, Demist is built for lectures: live text, explanations of unfamiliar words, and a transcript and glossary afterwards. If you only need captions on screen and nothing saved, Windows 11 Live Captions is free and built in. If you need every word to be accurate, a human speech-to-text reporter is still the better choice.' },
      { q: 'How accurate is Demist?', a: 'It depends mostly on the audio. It does well with a clear speaker close to the microphone or with audio straight from an online lecture, and worst with distant speakers and room noise. It will get some words wrong, so check anything important against your course materials.' },
      { q: 'Does it work for online lectures?', a: 'Yes. In the Windows app choose System audio; in Chrome or Edge choose Tab capture and tick Share tab audio.' },
      { q: 'Is the audio private?', a: 'In the Windows app, live lecture audio is transcribed on your own computer and does not leave it. The browser version sends audio to Demist\'s server to be transcribed.' },
    ],
  },
  {
    slug: 'dyslexia',
    audience: 'students with dyslexia',
    title: 'A lecture app for students with dyslexia',
    description:
      'Demist writes your lecture notes for you, reads them back, and explains new words in plain English, with Atkinson Hyperlegible and Lexend fonts, extra spacing and coloured tints. Free on Windows.',
    answer:
      'Demist is a lecture app for students with dyslexia who find listening and writing at the same time hard. It writes the lecture down for you, explains new words in plain English as they come up, and can read everything back. You can set the whole app to Atkinson Hyperlegible or Lexend, add line spacing, and use a coloured tint.',
    helps: [
      {
        heading: 'Listen instead of writing',
        body: 'Demist keeps the transcript, so you can follow the lecture without trying to get it onto paper at the same time. Afterwards there is a summary and a glossary of the words that came up.',
      },
      {
        heading: 'Read aloud',
        body: 'Explanations and transcripts can be read back to you, so you can listen to your notes instead of reading them.',
      },
      {
        heading: 'Reading settings',
        body: 'Choose Atkinson Hyperlegible or Lexend for the whole app, add extra line and word spacing, change the text size, and add a cream, blue, green or rose tint in light mode.',
      },
      {
        heading: 'New words, spelled and explained',
        body: 'Unfamiliar technical words appear written out with a short explanation, and go into your glossary and flashcards, so you are not trying to spell something you have only heard.',
      },
    ],
    notFor: [
      'Demist is for lectures. For reading long documents or writing essays, a dedicated reading or writing tool will do more.',
      'Automatic transcription makes mistakes, so check anything important against your course materials.',
      'Demist is not a DSA approved supplier, though the core of it is free without any funding.',
    ],
    faq: [
      { q: 'What is the best note-taking app for dyslexic students in lectures?', a: 'If the hard part is writing while listening, Demist takes that away: it keeps a live transcript, explains new words and can read your notes back. If you prefer to take your own notes alongside a recording, a tool built around that may suit you better.' },
      { q: 'Does Demist have a dyslexia-friendly font?', a: 'It offers Atkinson Hyperlegible and Lexend across the whole app, along with extra spacing, adjustable text size and coloured tints. People differ in what helps, so it is worth trying each.' },
      { q: 'Can it read my notes to me?', a: 'Yes. Explanations and transcripts have a read aloud button.' },
      { q: 'Do I need DSA funding?', a: 'No. Demist is not a DSA approved supplier, and the core of it is free for every student.' },
    ],
  },
  {
    slug: 'english-as-an-additional-language',
    audience: 'students studying in English as an additional language',
    title: 'Understand lectures in English when it is not your first language',
    description:
      'Demist writes down what your lecturer says, explains difficult words in simple English as they are said, and can translate the transcript sentence by sentence into Mandarin, Arabic, Hindi, Spanish or French. Free on Windows.',
    answer:
      'Demist helps people follow lectures and training courses in English when it is not their first language. It writes down what the lecturer says, explains difficult words in plain English while they are still talking, and can show the transcript and explanations translated into Mandarin, Arabic, Hindi, Spanish or French, sentence by sentence. In the Windows app, if you tell Demist English is not your first language, it also explains the less common everyday words a lecture relies on, not only technical terms.',
    helps: [
      {
        heading: 'Fast speech, written down',
        body: 'When a lecturer speaks quickly or has an accent you are not used to, you can read the words on screen as well as hear them, and read them again afterwards.',
      },
      {
        heading: 'Difficult words explained at once',
        body: 'You do not need to stop and look a word up, and miss the next sentence. A short explanation appears on screen while the lecturer keeps talking.',
      },
      {
        heading: 'More than technical terms',
        body: 'Words like "regulatory", "encompass" or "aspirations" are not technical, but they can still stop you. If you tell the Windows app English is not your first language, it explains words like these too.',
      },
      {
        heading: 'Build your vocabulary',
        body: 'Every word goes into your glossary and becomes a flashcard, so the words from this week\'s lecture stay with you. You can hear each one read aloud.',
      },
    ],
    notFor: [
      'Translation works on the written transcript, one sentence at a time, a moment behind the lecturer. It is automatic, so check anything important.',
      'The Windows app transcribes lectures given in English. For lectures in other languages, use the browser version.',
      'Automatic transcription makes mistakes, more often with strong accents and noisy rooms, so check anything important against your course materials.',
    ],
    faq: [
      { q: 'What is the best app to understand lectures in English as an international student?', a: 'Demist is built for this: it writes down the lecture, explains difficult words as they are said, and can translate the transcript and explanations sentence by sentence. It is made for lectures, so if you mainly need to translate conversations with people, a dedicated translation app will suit you better.' },
      { q: 'Does it work for training courses and webinars, not just university?', a: 'Yes. Anything you can hear on a microphone or on your computer works, including online courses and webinars on Zoom or Teams.' },
      { q: 'Which languages can it translate into?', a: 'Mandarin, Arabic, Hindi, Spanish and French, for both the transcript and the explanations.' },
      { q: 'Is it free?', a: 'The core of it is. Live explanations, translation, your glossary and flashcards are free, and recording is free and unlimited in the Windows app.' },
    ],
  },
]

export function getNeedPage(slug: string): NeedPage | undefined {
  return NEED_PAGES.find(p => p.slug === slug)
}
