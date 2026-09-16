// Demist is 18+. Not an arbitrary line: recording a lecture captures a third
// party (the lecturer) who has not agreed to anything, and the Terms make
// getting that right the user's own responsibility. That is a reasonable
// thing to ask of an adult and not a coherent thing to delegate to a child.
//
// This file exists because date_of_birth used to be collected and then never
// read by anything, while both the onboarding screen and the privacy policy
// told users it was being used "to keep Demist age-appropriate". It wasn't.
// A 10-year-old completed signup and recorded 8 sessions of primary school
// audio before anyone noticed.
export const MINIMUM_AGE = 18

/** Whole years between a YYYY-MM-DD date of birth and today. */
export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null
  const born = new Date(dob)
  if (Number.isNaN(born.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  // Birthday not reached yet this year.
  const monthDiff = now.getMonth() - born.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < born.getDate())) age--
  return age
}

/** Null when there's no usable date, so callers can tell "too young" apart
 *  from "we don't know yet" - those need different handling. */
export function meetsMinimumAge(dob: string | null | undefined): boolean | null {
  const age = ageFromDob(dob)
  if (age === null || age < 0 || age > 120) return null
  return age >= MINIMUM_AGE
}
