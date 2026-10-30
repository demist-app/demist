export function lectureTitle(s: { name: string | null; subject: string | null; started_at: string }) {
  if (s.name) return s.name
  if (s.subject) return s.subject
  return new Date(s.started_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function minutes(s: { started_at: string; ended_at: string | null }) {
  if (!s.ended_at) return null
  return Math.max(1, Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000))
}

// Short paragraphs instead of one wall of text, which is hard going for
// dyslexic readers. Dictation can run on for a minute without a full stop,
// so a long stretch is also broken by word count.
export function paragraphs(text: string, sentencesPer = 3, maxWords = 60): string[] {
  const out: string[] = []
  let current: string[] = []
  let words = 0
  for (const s of text.split(/(?<=[.!?])\s+/).filter(Boolean)) {
    const w = s.split(/\s+/)
    if (w.length > maxWords) {
      if (current.length) { out.push(current.join(' ')); current = []; words = 0 }
      for (let i = 0; i < w.length; i += maxWords) out.push(w.slice(i, i + maxWords).join(' '))
      continue
    }
    current.push(s); words += w.length
    if (current.length >= sentencesPer || words >= maxWords) { out.push(current.join(' ')); current = []; words = 0 }
  }
  if (current.length) out.push(current.join(' '))
  return out
}

export function clockFromMs(ms: number) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}
