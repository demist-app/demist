// Demist is 16+.
//
// The line is drawn by one specific risk: recording a lecture also records
// the lecturer, who has agreed to nothing, and the Terms make obtaining that
// permission the user's own responsibility. A sixth-form or IB student can
// reasonably be asked to do that. A primary school child cannot. 16 is where
// that reasoning breaks, and it is also GDPR Article 8's default - a
// recognised line rather than an invented one - while clearing COPPA's
// under-13 threshold by enough margin that verifiable parental consent never
// enters the picture.
//
// 18 was considered and rejected: it removes 16-17 year olds, who are a real
// and legitimate part of this user base (7 accounts against 5 under 16), for
// no additional safety in the thing that actually matters here.
//
// This file exists because date_of_birth used to be collected and then never
// read by anything, while both the onboarding screen and the privacy policy
// told users it was being used "to keep Demist age-appropriate". It wasn't.
// A 10-year-old completed signup and recorded 8 sessions of primary school
// audio before anyone noticed.
export const MINIMUM_AGE = 16

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

// Below this, the date is a typo rather than a person. Real live examples
// from the profiles table: an age of 0 (someone typed the current year) and
// an age of -17983 (a date ~18,000 years in the future). Nobody who signed
// up, set a support need and recorded a lecture is four years old, and
// treating those as "too young" would lock real adults out of their
// accounts over a mistyped year.
//
// Deliberately well below MINIMUM_AGE, not near it: 10 is entirely plausible
// as a real age here - one account genuinely belongs to a 10-year-old - so
// the implausibility floor must not become a loophole that waves real
// children through. Anything from 5 upward is taken at face value.
const IMPLAUSIBLY_YOUNG = 5

/** Null when there's no usable date, so callers can tell "too young" apart
 *  from "we don't know yet" - those need different handling. */
export function meetsMinimumAge(dob: string | null | undefined): boolean | null {
  const age = ageFromDob(dob)
  if (age === null || age < IMPLAUSIBLY_YOUNG || age > 120) return null
  return age >= MINIMUM_AGE
}
