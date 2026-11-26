import { PRO_PRICE_TEXT } from './pricing'

// These answers are read by search engines and AI assistants and quoted word
// for word (they are also the FAQPage JSON-LD on the home page), so every one
// must be true of the product as it ships. Checked against the code on
// 2026-11-26; recheck when pricing, limits or capture modes change.
export const FAQ = [
  {
    q: 'Is Demist free?',
    a: `The core of it is. Live explanations, translation, your glossary and flashcards are free, and so is unlimited recording in the Windows and iPhone apps. Free accounts also get full lecture notes for 3 lectures a month. In the browser, free accounts get 3 recordings, and free accounts keep lecture history for 7 days. Demist Pro writes notes for every lecture, keeps every lecture, lets you listen back to lectures in the Windows app, removes the browser limit and adds Anki export, for ${PRO_PRICE_TEXT.monthly} a month or ${PRO_PRICE_TEXT.yearly} a year (the student price, open to everyone). New accounts get Pro free for their first 14 days, with no card.`,
  },
  {
    q: 'Does Demist write lecture notes?',
    a: 'Yes. When a lecture ends, Demist writes notes from its transcript: short sections with headings and points you can revise from. Deadlines, exam hints and anything the lecturer said to remember are quoted in their own words, and any point with a number or name the lecturer did not say is left out. Notes are made on the website now, and in the Windows app from version 1.0.12, where they are written on your own computer. They need the lecture\'s transcript, which is kept when your lecturer has given permission to record or you have told Demist about a support need. Free accounts get notes for 3 lectures a month; Pro makes them for every lecture. More at demist.app/lecture-notes.',
  },
  {
    q: 'Can Demist record my lecture so I can listen back?',
    a: 'In the Windows app with Pro, yes. Demist keeps the lecture\'s audio on your own computer, never on a server, and you can tap any sentence of the transcript to hear that moment again. In every version, a lecture\'s written transcript is kept when your lecturer has given permission or you have told Demist about a support need, so you can read back over anything you missed. Audio follows the same rule, so check your university\'s recording policy first.',
  },
  {
    q: 'What subjects does it support?',
    a: 'Any subject. Concept detection picks up on whatever your lecturer is covering, whether that\'s biochemistry, contract law, or computer science.',
  },
  {
    q: 'Does it work offline?',
    a: 'Not fully, in either version. On the website, recording and term detection are processed on our servers, so both need a connection. The Windows app does all of that on your own machine, but it still loads its interface from demist.app, so it needs a connection to start. Your saved glossary, session history and flashcard queue stay available to browse once loaded.',
  },
  {
    q: 'Is there an iPhone app?',
    a: 'Yes, free on the App Store, for iPhone with iOS 16.4 or later. Speech is turned into text by Apple\'s recognition on the phone itself, so the lecture audio stays on the phone. To explain a word, the word and the sentence it came from are sent to our server. It keeps recording with the screen locked, and your glossary and flashcards are the same ones you see on the web. Pro bought on the website works in the app too.',
  },
  {
    q: 'Is there a Windows app?',
    a: 'Yes, free on the Microsoft Store. It transcribes live lectures on your own computer rather than sending the audio to a server, so the audio of a live lecture never leaves the machine. Uploading a recording is different: that is transcribed on our server in every version. Your glossary, flashcards and history sync to your account so they follow you across devices.',
  },
  {
    q: 'What file formats can I import?',
    a: 'You can upload a recording (MP3, WAV, M4A, MP4, WebM or OGG, up to 50 MB), a slide deck or document (PPTX, DOCX), or a plain text transcript. Demist picks out the terms and explains them.',
  },
  {
    q: 'Why isn\'t Demist detecting any concepts?',
    a: 'Check that your browser has microphone access and that the session is recording. If the lecture content is mostly familiar, fewer concepts will get flagged. If it still isn\'t working, reload and start a new session.',
  },
  {
    q: 'The microphone isn\'t working',
    a: 'Go to your browser\'s site settings for demist.app and confirm microphone permission is set to Allow. In Chrome, click the padlock icon in the address bar → Site settings → Microphone → Allow, then reload the page.',
  },
  {
    q: 'Does it work during online lectures on Zoom or Teams?',
    a: 'Yes. In Chrome or Edge, choose Tab capture, pick the tab with the lecture and tick Share tab audio. In the Windows app, choose System audio, which listens to everything playing on the PC. The same works for recorded lectures on Panopto, Teams or Zoom playing in a tab.',
  },
  {
    q: 'Where is my data stored?',
    a: 'Your data is tied to your account and not shared. In the browser, audio is sent to our server for transcription and is not kept afterwards; an uploaded recording is deleted once it has been processed. In the Windows app, live lecture audio is processed on your own computer. The privacy policy has the details.',
  },
  {
    q: 'Does Demist help students with ADHD?',
    a: 'It is built for losing the thread in a lecture. A live transcript lets you catch up after your attention drifts, unfamiliar words are explained as they are said, and an I\'m lost button marks the moment so you can go back to it. It is not a treatment or a task manager. More at demist.app/for/adhd.',
  },
  {
    q: 'Can deaf or hard of hearing students use Demist?',
    a: 'Yes. It shows live text of the lecture on your own screen and keeps the transcript afterwards. It is automatic transcription, so it makes mistakes and does not replace a human notetaker or speech-to-text reporter where you need every word. More at demist.app/for/deaf-and-hard-of-hearing.',
  },
  {
    q: 'Does Demist help with dyslexia?',
    a: 'It writes the lecture down so you do not have to listen and write at once, and it can read your notes back. You can use Atkinson Hyperlegible or Lexend across the app, with extra spacing and coloured tints. More at demist.app/for/dyslexia.',
  },
  {
    q: 'Does it help if English is not my first language?',
    a: 'Yes. It writes down what is said, explains difficult words in plain English, and can translate the transcript and explanations into Mandarin, Arabic, Hindi, Spanish or French. More at demist.app/for/english-as-an-additional-language.',
  },
  {
    q: 'Is Demist available through DSA?',
    a: 'Demist is not a DSA-approved supplier. It does not need DSA funding, though: the core of it is free for every student. If you are working with a needs assessor or a disability adviser, see demist.app/about.',
  },
]
