// GENERATED from web/lib/mySpaceContent.ts by scripts/sync-shared.mjs. Do not edit here.
// My Space starter content (2026-11-07).
//
// Copied into each student's own rows the first time they open My Space
// (my_space_seed, migration 043), after which every item is theirs to edit,
// delete or add to. Changing this file changes what NEW students start with;
// it never touches anyone's existing copy.
//
// Written by Demist, not by students, and labelled that way on screen. The
// student ideas email asked for a library from students with lived
// experience; that needs consent and moderation and comes later. These must
// never be presented as real students' words.
//
// RULES: plain, kind and short. Suggestions, never instructions or clinical
// advice; nothing here claims to treat anything. UK spelling. Customer-facing,
// so never the word "AI" and never an em dash. Each item is at most 300
// characters (the database checks).

export type Feeling = 'overwhelmed' | 'anxious' | 'alone' | 'stuck'
export type Topic = 'life' | 'anxiety' | 'family' | 'relationships' | 'overwhelm' | 'education'

export const FEELINGS: { value: Feeling; label: string }[] = [
  { value: 'overwhelmed', label: 'I’m overwhelmed' },
  { value: 'anxious', label: 'I’m feeling anxious' },
  { value: 'alone', label: 'I’m feeling alone' },
  { value: 'stuck', label: 'I can’t get started' },
]

export const TOPICS: { value: Topic; label: string }[] = [
  { value: 'life', label: 'Life' },
  { value: 'anxiety', label: 'Anxiety' },
  { value: 'family', label: 'Family' },
  { value: 'relationships', label: 'Relationships' },
  { value: 'overwhelm', label: 'Overwhelm' },
  { value: 'education', label: 'Education' },
]

const TOOLBOX: Record<Feeling, string[]> = {
  overwhelmed: [
    'Write down everything on your mind, then pick just one thing to do first.',
    'Move anything that is not due this week to Later. It will still be there.',
    'Do the smallest possible piece: open the document, or write one sentence.',
    'Set a timer for 10 minutes and work only until it goes off.',
    'Close every tab and app you do not need right now.',
    'Drink some water and eat something, even something small.',
    'Step outside or open a window for a few minutes.',
    'Tell one person, “I’m finding things a lot right now.”',
    'Put on headphones with music or sounds that help you settle.',
    'Remind yourself: I don’t have to do everything today.',
  ],
  anxious: [
    'Breathe in for four, hold for four, and breathe out for six. Repeat a few times.',
    'Name five things you can see, four you can hear and three you can touch.',
    'Hold something cold, or splash cold water on your face.',
    'Press your feet into the floor and notice them there.',
    'Write the worry down, then close the notebook.',
    'Ask yourself: is this something I can sort out today? If not, park it for later.',
    'Go for a short walk, even just around the room.',
    'Listen to a song you know every word of.',
    'Text someone you trust, even if it is just “hey”.',
    'Remember: this feeling is strong, and it will pass.',
  ],
  alone: [
    'Message one person, even a short “how are you?”',
    'Go somewhere with people around: a library, a café or a common room.',
    'Call someone instead of texting. Hearing a voice can help.',
    'Go to a society or club meeting, just to listen the first time.',
    'Talk to your university’s student support or wellbeing team.',
    'Watch or listen to something comforting that you have enjoyed before.',
    'Write down three people you could talk to, ready for next time.',
    'Look after something: water a plant, cook a meal or tidy one shelf.',
    'Remember that lots of students feel this way, even when it does not show.',
    'Be as kind to yourself as you would be to a friend who felt like this.',
  ],
  stuck: [
    'Do the first two minutes only. You can stop after that.',
    'Write the task as one tiny step, like “open the reading”.',
    'Start in the middle, with the easiest part.',
    'Work alongside someone else, in person or on a video call.',
    'Change where you are: another room, a library or a café.',
    'Put your phone in another room for 20 minutes.',
    'Tell someone what you are about to start, so it feels real.',
    'Make it rough on purpose. A messy first try still counts.',
    'Plan a small reward for afterwards, something you enjoy.',
    'If today is not working, choose one tiny thing, then rest.',
  ],
}

const MESSAGES: Record<Topic, string[]> = {
  life: [
    'You don’t have to have it all worked out yet.',
    'Small steps still move you forward.',
    'Rest is part of the work, not a break from it.',
    'It’s okay to do things your own way and at your own pace.',
    'A hard day is not a hard life.',
    'You have got through every difficult day so far.',
    'Comparing yourself to others leaves out most of your story.',
    'Asking for help is a skill, not a weakness.',
    'Today, being kind to yourself counts as progress.',
    'You are allowed to change your mind about what you want.',
  ],
  anxiety: [
    'This feeling will pass, even if it doesn’t feel like it right now.',
    'My thoughts are not always facts.',
    'I can feel anxious and still do the next small thing.',
    'I don’t have to fight this feeling. I can let it be here and keep going.',
    'I have felt like this before and come through it.',
    'Slowing down is allowed.',
    'I can take this one minute at a time.',
    'It’s okay to step away and come back.',
    'My body is trying to protect me. I can help it settle.',
    'I am doing better than my anxiety tells me.',
  ],
  family: [
    'It’s okay to need space from family and to love them too.',
    'I am allowed to set boundaries, even with people I care about.',
    'Other people’s expectations don’t have to be my plans.',
    'I can only control my part of a conversation.',
    'Family can be the people I choose, too.',
    'I can be proud of myself even if no one says it.',
    'It’s okay if home feels complicated.',
    'I don’t have to fix everyone else’s problems.',
    'I can call home when I am ready, not only when I feel I should.',
    'Missing home means I have something worth missing.',
  ],
  relationships: [
    'The right people won’t need me to be someone else.',
    'It’s okay to take time to reply.',
    'I deserve friendships that feel safe.',
    'One good friend is enough to start with.',
    'Saying no is allowed.',
    'I can ask for what I need, clearly and kindly.',
    'People who matter will understand a cancelled plan.',
    'It’s okay if friendships change over time.',
    'I am worth getting to know.',
    'Feeling awkward doesn’t mean it went badly.',
  ],
  overwhelm: [
    'One thing at a time. Just the next one.',
    'I don’t have to do everything today.',
    'Done is better than perfect.',
    'It’s okay to put some things down for now.',
    'I can make today smaller.',
    'When everything feels urgent, I can choose what matters most.',
    'Taking a break now can save time later.',
    'Feeling overwhelmed means I am carrying a lot, not that I am failing.',
    'I’m allowed to ask for an extension or more time.',
    'Breathe first. Then decide.',
  ],
  education: [
    'Not understanding something yet is how learning starts.',
    'Every expert was once a beginner.',
    'My grades are not my worth.',
    'Asking a question in class often helps someone else too.',
    'I learn in my own way, and that’s okay.',
    'Missing part of a lecture doesn’t mean I have missed everything.',
    'It’s okay to reread, rewatch and go over things again.',
    'Reasonable adjustments are there to be used.',
    'A bad mark is information, not a verdict.',
    'I belong here as much as anyone else.',
  ],
}

// The shape my_space_seed expects.
export const STARTER_TOOLBOX = (Object.keys(TOOLBOX) as Feeling[]).flatMap(feeling =>
  TOOLBOX[feeling].map((text, position) => ({ feeling, text, position })),
)
export const STARTER_MESSAGES = (Object.keys(MESSAGES) as Topic[]).flatMap(topic =>
  MESSAGES[topic].map(text => ({ topic, text })),
)

// Shown at the foot of every My Space screen. UK services, plus a line for
// everyone else; Graceful Minds may later swap in the contacts they use.
export const CRISIS_LINES: { name: string; detail: string; href?: string }[] = [
  { name: 'In danger now', detail: 'Call 999, or your local emergency number.', href: 'tel:999' },
  { name: 'Samaritans', detail: 'Call 116 123, free, any time of day or night.', href: 'tel:116123' },
  { name: 'Shout', detail: 'Text SHOUT to 85258, free, any time.', href: 'sms:85258?&body=SHOUT' },
  { name: 'NHS 111', detail: 'Call 111 for urgent help that is not an emergency.', href: 'tel:111' },
]
