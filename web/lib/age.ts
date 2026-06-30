export function isUnder18(dob: string | null | undefined): boolean {
  if (!dob) return false // unknown age: protective defaults are applied to everyone regardless
  const d = new Date(dob)
  if (isNaN(d.getTime())) return false
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age < 18
}
