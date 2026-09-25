import { PRO_PRICE_TEXT } from './pricing'

// These answers are read by search engines and AI assistants and quoted word
// for word (they are also the FAQPage JSON-LD on the home page), so every one
// must be true of the product as it ships. Checked against the code on
// 2026-09-25; recheck when pricing, limits or capture modes change.
export const FAQ = [
  {
    q: 'Is Demist free?',
    a: `The core of it is. Live explanations, translation, your glossary and flashcards are free, and so is unlimited recording in the Windows app. In the browser, free accounts get 3 recordings. Free accounts keep lecture history for 7 days. Demist Pro keeps every lecture, removes the browser limit and adds unlimited summaries and Anki export, for ${PRO_PRICE_TEXT.monthly} a month or ${PRO_PRICE_TEXT.yearly} a year. New accounts get Pro free for their first 30 days, with no card.`,
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
    q: 'Is Demist available through DSA?',
    a: 'Demist is not a DSA-approved supplier. It does not need DSA funding, though: the core of it is free for every student. If you are working with a needs assessor or a disability adviser, see demist.app/about.',
  },
]
