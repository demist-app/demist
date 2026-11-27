// /for-lecturers: for a lecturer deciding whether to tell a class about Demist.
//
// WHY (2026-11-27). One lecturer reaches a whole class, and students who heard
// about Demist from a lecturer were among the few who came back. The share
// message carries utm_source=lecturer so first-touch attribution counts them.
//
// RULES: every claim must match the product (recording rule from lib/faq.ts:
// transcripts are kept with lecturer permission or a support need; listen back
// keeps audio on the student's own Windows computer, Pro only). No clinical
// claims, never the word "AI", never an em dash, no iPhone app mentions.

export const LECTURER_PAGE_URL = 'https://www.demist.app/for-lecturers'
export const LECTURER_PAGE_REVIEWED = '2026-11-27'
export const LECTURER_SHARE_LINK = 'https://demist.app/?utm_source=lecturer'

export const LECTURER_PAGE = {
  title: 'Demist for lecturers: a free lecture helper you can recommend to your class',
  description: 'What Demist does for students in your lectures, how recording permission works, and a short message you can post for your class.',
  answer: 'Demist is a free app from the charity Graceful Minds that helps students follow lectures. It shows a live transcript, explains subject vocabulary in plain English as you say it, and writes notes afterwards. There is nothing for you to set up: students install it themselves, and you only need to tell them it exists and whether they may record.',
  sections: [
    { heading: 'What your students see', body: 'A live transcript of what you are saying, and short explanations of specialist words the moment you use them. After the lecture, notes in sections with headings, with deadlines and exam hints quoted in your own words, and flashcards of the new vocabulary.' },
    { heading: 'Who it helps most', body: 'Students who lose the thread when attention drifts, students with dyslexia or hearing loss, and students whose first language is not English. They can catch up without asking you to repeat yourself or waiting for the recording.' },
    { heading: 'Recording and permission', body: 'Demist keeps a lecture\'s transcript only when the student says their lecturer has given permission to record, or they have told Demist about a support need. Without either, the explanations still work live but the transcript is not kept. In the Windows app with Pro, audio is kept on the student\'s own computer, never on a server. Please follow your university\'s recording policy, and tell your class what you allow.' },
    { heading: 'Recorded lectures too', body: 'Students can also use Demist with lecture recordings playing in a browser tab, such as Panopto or Teams, and pause and rewind while it explains.' },
  ],
  notFor: [
    'It is not a captioning service. Automatic transcripts and explanations can be wrong, and the app says so.',
    'It does not replace reasonable adjustments, note-takers or captioners arranged through your disability service.',
    'It does not need, and cannot use, anything installed on lecture room computers.',
  ],
  shareMessage: 'If you find lectures hard to follow, Demist is a free app that shows a live transcript, explains difficult words as I say them, and writes notes afterwards. It is made by the charity Graceful Minds. You are welcome to use it in my lectures. Get it at https://demist.app/?utm_source=lecturer',
  faq: [
    { q: 'Do I need to do anything for my students to use Demist?', a: 'No. Students install it themselves on their own laptop. If you are happy for them to keep a transcript, say so, because Demist asks them whether their lecturer has given permission.' },
    { q: 'Does Demist record my lectures?', a: 'It listens on the student\'s own device. The transcript is kept only with your permission or when the student has a support need, and audio is kept only in the Windows app with Pro, on the student\'s own computer.' },
    { q: 'Can our department get it for all students?', a: 'Yes. Graceful Minds is offering disability and student support teams free Pro for their students until 30 June 2027. Email shivam@demist.app.' },
    { q: 'Is it free?', a: 'Yes. Live explanations, the glossary and flashcards are free, and recording is unlimited in the Windows app. Pro adds notes for every lecture and keeps the whole term.' },
  ],
}
