export function lectureTitle(s: { name: string | null; subject: string | null; started_at: string }) {
  if (s.name) return s.name
  if (s.subject) return s.subject
  return new Date(s.started_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function minutes(s: { started_at: string; ended_at: string | null }) {
  if (!s.ended_at) return null
  return Math.max(1, Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000))
}

export function clockFromMs(ms: number) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}
