// GENERATED from web/lib/lectureNotes.ts by scripts/sync-shared.mjs. Do not edit here.
// Lecture notes: the part that is the same wherever they are written (on the
// student's computer in the desktop app, or on our server for the website).
// Pure, no React and no network, so it can be tested with node directly.
//
// WHY (2026-11-24). "Summary" was one or two sentences written from the word
// list. Students asked for notes ("i need better notes not just definitions"),
// and a lecture with a full transcript but no words found got nothing at all.
// These are written from the transcript itself.
//
// Trust, in two parts, because a small model on a laptop does slip:
// - groundedPoints drops any point with a number or a name the lecturer did
//   not say. Measured on the bundled 1.5B model: it wrote "a limited capacity
//   of about 5-7 items" for a lecture that never said so.
// - reminders are the lecturer's own sentences about deadlines, exams and
//   reading, copied from the transcript, so they cannot be wrong. The same
//   model left the essay deadline out altogether.
// Both run when notes are SHOWN, so improving them improves old notes too.
//
// Stored as JSON in sessions.summary (a column that existed and was never
// used), which is owner-only like the rest of the row.

export interface NotesSection { heading: string; points: string[] }
export interface LectureNotes { v: 1; by: 'device' | 'server'; sections: NotesSection[] }

// Below this a transcript is a test recording, not a lecture.
export const NOTES_MIN_CHARS = 1500
// One on-device request. Short pieces, because the 1.5B model covers about six
// ideas however much it is given: at 2,000 characters it skipped a whole
// topic of a test lecture, at 1,200 it did not (2026-11-24). Also fits the
// 2,048-token context that computers with little memory use.
export const NOTES_CHUNK_CHARS = 1200

export function sentencesOf(text: string): string[] {
  return (text.match(/[^.?!。！？]+(?:[.?!。！？]+["'”’)]*|$)\s*/g) ?? []).map(s => s.trim()).filter(Boolean)
}

// Whole sentences, up to max characters each. A run with no punctuation (some
// recognisers give none) is cut on a space instead, so nothing is ever skipped.
export function splitForNotes(transcript: string, max = NOTES_CHUNK_CHARS): string[] {
  const out: string[] = []
  let cur = ''
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = '' }
  for (let s of sentencesOf(transcript)) {
    while (s.length > max) {
      push()
      const cut = s.lastIndexOf(' ', max)
      const at = cut > max / 2 ? cut : max
      out.push(s.slice(0, at).trim())
      s = s.slice(at).trim()
    }
    if (cur && cur.length + s.length + 1 > max) push()
    cur = cur ? `${cur} ${s}` : s
  }
  // A tail too short to say anything on its own joins the piece before it.
  if (cur && out.length && cur.length < 200) out[out.length - 1] += ` ${cur}`
  else push()
  return out
}

export function parseNotes(raw: string | null | undefined): LectureNotes | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as LectureNotes
    if (o?.v !== 1 || !Array.isArray(o.sections)) return null
    const sections = o.sections.map(cleanSection).filter((s): s is NotesSection => !!s)
    return sections.length ? { v: 1, by: o.by === 'device' ? 'device' : 'server', sections } : null
  } catch {
    return null
  }
}

// Whatever a model returned, as a section or nothing.
export function cleanSection(s: unknown): NotesSection | null {
  const o = s as { heading?: unknown; points?: unknown }
  if (!o || !Array.isArray(o.points)) return null
  const points: string[] = []
  for (const p of o.points) {
    if (typeof p !== 'string') continue
    const t = p.replace(/^\s*[-•*]\s*/, '').replace(/\s+/g, ' ').trim()
    if (t.length < 12 || t.length > 600) continue
    if (points.some(q => q.toLowerCase() === t.toLowerCase())) continue
    points.push(t)
  }
  if (!points.length) return null
  const heading = (typeof o.heading === 'string' ? o.heading : '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return { heading, points }
}

// ── Grounding ────────────────────────────────────────────────────────────────

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19,
}
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  twentieth: 20, thirtieth: 30,
}
const SCALE: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000 }

// Every number the text contains, as digit strings, including ones written as
// words ("nineteen sixty eight" is 1968, "the twelfth" is 12), because some
// recognisers write words and the notes write digits.
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const n = m[0].replace(/,(?=\d{3}\b)/g, '')
    out.add(n)
    for (const part of n.split(/[.,]/)) out.add(String(Number(part)))
  }
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  for (let i = 0; i < words.length; i++) {
    let j = i
    const vals: number[] = []      // consecutive numbers below 100, as spoken
    let total = 0, cur = 0, any = false, scaled = false
    while (j < words.length) {
      const w = words[j]
      if (w in TENS) {
        const next = words[j + 1]
        const v = TENS[w] + (next in UNITS && UNITS[next] > 0 && UNITS[next] < 10 ? UNITS[next] : 0)
        if (v !== TENS[w]) j++
        vals.push(v); cur += v; any = true
      } else if (w in UNITS) {
        vals.push(UNITS[w]); cur += UNITS[w]; any = true
      } else if (w in SCALE && any) {
        scaled = true
        if (SCALE[w] === 100) cur = (cur || 1) * 100
        else { total += (cur || 1) * SCALE[w]; cur = 0 }
      } else if (w === 'and' && any && j + 1 < words.length && (words[j + 1] in UNITS || words[j + 1] in TENS)) {
        // "two hundred and five"
      } else break
      j++
    }
    if (any) {
      out.add(String(total + cur))
      // "two hundred and five" is 205, not also a 2 and a 5.
      if (!scaled) for (const v of vals) out.add(String(v))
      // Years and other numbers said in two halves: "nineteen sixty eight".
      for (let k = 0; k + 1 < vals.length; k++) {
        if (vals[k] >= 10 && vals[k + 1] >= 10) out.add(String(vals[k] * 100 + vals[k + 1]))
      }
      i = j - 1
    }
  }
  return out
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Names and other capitalised words inside a sentence (not its first word).
function namesIn(point: string): string[] {
  const out: string[] = []
  for (const m of point.matchAll(/(?<=[^.?!:]\s["'(“‘]?)\p{Lu}[\p{L}'’-]{2,}/gu)) out.push(m[0].replace(/['’]s$/, ''))
  return out
}

function nearEqual(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

// The meaning-carrying words of a text, cut to a stem so "controls" matches
// "controlling". Six letters keeps "education" and "educational" together
// without joining unrelated words.
const STEM = 6
const stems = (t: string) => fold(t).split(/[^\p{L}]+/u).filter(w => w.length > 4).map(w => w.replace(/e?s$/, '').slice(0, STEM))
// A point is kept when at least this share of its longer words were said.
// Real points from a lecture score 0.7 and up; textbook padding a small model
// adds from memory ("a complex set of cognitive processes that includes
// planning, organizing...") scores 0.2 to 0.4.
const MIN_SAID = 0.5

export function makeGrounder(transcript: string): (point: string) => boolean {
  const numbers = numbersIn(transcript)
  const saidStems = new Set(stems(transcript))
  const words = new Set(fold(transcript).split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  const list = [...words]
  // In German every noun has a capital, so capitals say nothing about names.
  const mid = transcript.match(/(?<=[^.?!:]\s)\p{L}{3,}/gu) ?? []
  const capitals = mid.filter(w => /^\p{Lu}/u.test(w)).length
  const namesMeanSomething = mid.length > 0 && capitals / mid.length < 0.2
  const said = (w: string) => {
    const f = fold(w)
    return f.split(/[^\p{L}\p{N}]+/u).filter(x => x.length > 2).every(part =>
      words.has(part) || (part.endsWith('s') && words.has(part.slice(0, -1))) || words.has(`${part}s`) || list.some(x => nearEqual(x, part)))
  }
  return (point: string) => {
    for (const m of point.matchAll(/\d+(?:[.,]\d+)*/g)) {
      const n = m[0].replace(/,(?=\d{3}\b)/g, '')
      if (!numbers.has(n) && !numbers.has(String(Number(n)))) return false
    }
    if (namesMeanSomething && namesIn(point).some(w => !said(w))) return false
    const mine = stems(point)
    if (mine.length >= 4 && mine.filter(w => saidStems.has(w)).length / mine.length < MIN_SAID) return false
    return true
  }
}

// A small model sometimes makes the same point twice in different orders. The
// shorter one says nothing the longer does not when nearly all its words are
// already there.
function sameIdea(a: string, b: string): boolean {
  const x = stems(a), y = new Set(stems(b))
  return x.length > 0 && x.filter(w => y.has(w)).length / x.length >= 0.85
}

// The notes as shown: only points the transcript supports, and sections that
// carry the same heading one after another joined up.
export function groundedNotes(notes: LectureNotes, transcript: string | null): NotesSection[] {
  const ok = transcript ? makeGrounder(transcript) : () => true
  const out: NotesSection[] = []
  for (const s of notes.sections) {
    const prev = out[out.length - 1]
    const join = !!prev && fold(prev.heading) === fold(s.heading)
    const into = join ? prev : { heading: s.heading, points: [] as string[] }
    for (const p of s.points) if (ok(p) && !into.points.some(q => sameIdea(p, q))) into.points.push(p)
    if (!join && into.points.length) out.push(into)
  }
  return out
}

// ── Reminders ────────────────────────────────────────────────────────────────

const REMINDER = new RegExp([
  String.raw`\b(is|are|it'?s|'s)\s+due\b`, String.raw`\bdue (on|by|in|next|this|date)\b`, String.raw`\bdeadline\b`,
  String.raw`\b(hand|handed) (it|them|your \w+)? ?in\b`, String.raw`\bsubmit\b`, String.raw`\bturnitin\b`, String.raw`\bword (count|limit)\b`,
  String.raw`\b(on|in|for) (the|your) (exam|final|mid ?-?term|test|quiz)\b`, String.raw`\b(mid ?-?term|exam|quiz)\b.{0,40}\b(question|will|is on|cover)`,
  String.raw`\bwill (be|come up) (on|in) the (exam|test)\b`, String.raw`\bfor next (week|time|lecture|seminar|class)\b`,
  String.raw`\bplease read\b`, String.raw`\bread chapters?\b`, String.raw`\b(moved|moving) to (room|building)\b`,
  // French
  String.raw`à rendre\b`, String.raw`date limite`, String.raw`pour la (semaine|prochaine)`, String.raw`à l'examen`, String.raw`\bpartiel\b`,
].join('|'), 'iu')

export function reminders(transcript: string | null, max = 8): string[] {
  if (!transcript) return []
  const out: string[] = []
  for (const s of sentencesOf(transcript)) {
    if (s.length < 15 || s.length > 320 || !REMINDER.test(s)) continue
    const t = s.replace(/^(?:(?:okay|ok|so|and|um|uh|right|now|but|yeah)\b[\s,]*)+/i, '').trim()
    const shown = t.charAt(0).toUpperCase() + t.slice(1)
    if (!out.includes(shown)) out.push(shown)
    if (out.length >= max) break
  }
  return out
}

export function notesAsText(title: string, sections: NotesSection[], remind: string[]): string {
  const lines = [title, '']
  for (const s of sections) {
    if (s.heading) lines.push(s.heading)
    for (const p of s.points) lines.push(`- ${p}`)
    lines.push('')
  }
  if (remind.length) lines.push('Dates and reminders, in the lecturer’s words', ...remind.map(r => `- ${r}`), '')
  lines.push('Made automatically from the transcript. Check anything important against your lecture.')
  return lines.join('\n')
}
