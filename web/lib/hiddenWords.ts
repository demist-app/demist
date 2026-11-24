// Words a student has deleted from their glossary, so Demist does not bring
// them back in the next lecture. Deleting is a hard delete, and until
// 2026-11-24 nothing remembered it: the two most active students had removed
// about 260 words by hand.
//
// Kept in this browser (or desktop app) only. The words are deleted from the
// database when the student deletes them, and keeping a copy there to remember
// the deletion would undo it.

const KEY = (userId: string) => `demist_hidden_words_${userId}`
const MAX = 2000

const norm = (term: string) => term.trim().toLowerCase().replace(/\s+/g, ' ')

export function hiddenWords(userId: string | null | undefined): Set<string> {
  if (!userId) return new Set()
  try {
    const list = JSON.parse(localStorage.getItem(KEY(userId)) ?? '[]')
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function hideWords(userId: string | null | undefined, terms: string[]): void {
  if (!userId || !terms.length) return
  try {
    const all = [...hiddenWords(userId)].filter(w => !terms.some(t => norm(t) === w))
    localStorage.setItem(KEY(userId), JSON.stringify([...all, ...terms.map(norm).filter(Boolean)].slice(-MAX)))
  } catch { /* storage full or blocked: the word is deleted, it just may come back */ }
}

export function isHidden(hidden: Set<string>, term: string): boolean {
  return hidden.has(norm(term))
}
