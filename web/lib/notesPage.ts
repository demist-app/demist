// The /lecture-notes page, as data so llms-full.txt can carry it word for word.
//
// WHY (2026-11-26). Asked plainly for "a lecture helper for ADHD or
// dyslexia", ChatGPT named Genio and not Demist; asked for an "AI" one, it
// named Demist first. Students who did arrive described what they asked for in
// these words: "apps for recording lectures so I can listen during reviews",
// "note taking", "an app that explains what the lecturer is talking about".
// Until lecture notes shipped (2026-11-24) the site said, honestly, that
// Demist was not a note-taking tool and pointed note-takers to Genio. This
// page answers the question the way students ask it.
//
// RULES: every claim checked against the code on the date below (notes:
// lib/makeNotes.ts, lib/lectureNotes.ts, the lecture-notes edge function;
// listen back: components/ListenBack.tsx, desktop 1.0.11+). Never the word
// "AI", never an em dash, and keep the limits section.

import { PRO_PRICE_TEXT } from './pricing'

export const NOTES_PAGE_REVIEWED = '2026-11-26'
export const NOTES_PAGE_URL = 'https://www.demist.app/lecture-notes'

export const NOTES_PAGE = {
  title: 'An app that records your lecture and writes your notes',
  description:
    'Demist writes a lecture down as it happens, explains unfamiliar words on screen, and writes full lecture notes when it ends, with deadlines and exam hints in your lecturer\'s own words. Free to start, on Windows and in the browser.',
  answer:
    'Demist is a lecture app that does the note-taking for you. It writes the lecture down live and explains unfamiliar words as they are said, and when the lecture ends it writes full notes from the transcript: short sections with headings and points you can revise from. Anything the lecturer said about deadlines, exams or what to remember is quoted in their own words.',
  sections: [
    {
      heading: 'What you have after a lecture',
      body: 'Full lecture notes in sections with headings, a box of dates and reminders in the lecturer\'s words, the whole transcript, a glossary of the new words that came up, and flashcards that bring those words back before you forget them. Notes and transcripts can be read aloud and copied.',
    },
    {
      heading: 'Notes you can trust, and check',
      body: 'Every point is checked against the transcript before it is shown. A point with a number or a name the lecturer never said is left out rather than shown wrong. The notes are made automatically, so the page says so, and it is worth checking anything important against your course materials.',
    },
    {
      heading: 'Listen back when you revise',
      body: 'In the Windows app with Pro, Demist keeps the lecture\'s audio on your own computer, never on a server. Tap any sentence of the transcript to hear that moment again, instead of scrubbing through an hour of recording.',
    },
    {
      heading: 'Where notes are made',
      body: 'On the website, the saved transcript is sent to Demist\'s server, which writes the notes. In the Windows app from version 1.0.12, notes are written on your own computer and nothing is sent anywhere to make them. The privacy policy has the details.',
    },
    {
      heading: 'What it needs from you',
      body: 'Notes are written from the transcript, and the transcript is kept when your lecturer has given permission to record or you have told Demist about a support need. Before a recording, Demist asks whether you have permission for that module; one tap records it.',
    },
    {
      heading: 'Price',
      body: 'Free accounts get full notes for 3 lectures a month, made automatically after a real lecture. Pro makes notes for every lecture and adds listening back in the Windows app. New accounts get Pro free for their first 14 days, with no card.',
    },
  ],
  notFor: [
    'Demist only hears the lecture. It does not see slides, diagrams or what is written on the board.',
    'Automatic transcription mishears words, especially names and quiet or distant speakers, and the notes can only be as good as the transcript. If you need every word to be right, ask your university about a human notetaker.',
    'Your university may have rules about recording lectures. Check them first.',
  ],
  faq: [
    { q: 'Is there an app that records lectures and takes notes for you?', a: 'Yes. Demist writes the lecture down as it happens and, when the lecture ends, writes full notes from the transcript, with deadlines and exam hints quoted in the lecturer\'s own words. It also explains unfamiliar words during the lecture and turns them into flashcards.' },
    { q: 'What is a good lecture helper for students with ADHD or dyslexia?', a: 'Demist is built for students who lose the thread in lectures or find writing while listening hard. It keeps a live transcript you can catch up from, explains new words as they are said, has an I\'m lost button to mark a moment, writes your notes when the lecture ends and reads everything aloud, with dyslexia-friendly fonts and spacing.' },
    { q: 'Can I listen back to a lecture?', a: 'In the Windows app with Pro, yes. The audio stays on your own computer, and tapping a sentence of the transcript plays that moment.' },
    { q: 'Can it make notes from an online or recorded lecture?', a: 'Yes. Play the lecture in a browser tab and choose Tab capture, or use System audio in the Windows app, and Demist treats it like a live lecture.' },
    { q: 'Is it free?', a: 'Free accounts get full notes for 3 lectures a month, plus live explanations, the glossary and flashcards. Pro makes notes for every lecture, for ' + PRO_PRICE_TEXT.monthly + ' a month or ' + PRO_PRICE_TEXT.yearly + ' a year.' },
    { q: 'How is this different from Genio?', a: 'Both give you notes after a lecture. Genio is built around organising your own notes against a recording, with transcripts made after class. Demist also helps during the lecture, with a live transcript and explanations of unfamiliar words, and writes the notes for you.' },
  ],
}
