'use client'

// Day / Month / Year, in place of <input type="date">.
//
// WHY (2026-10-20). Every rage click recorded on /onboarding was on the date
// of birth field: six students, one of them 25 times. Chrome's date input on
// Windows opens a calendar on today's month, so reaching a birthday 18 years
// back means clicking through 200+ months, and typing into its segments is
// not obvious either. Three plain boxes are what people expect for a birthday,
// and they match the iOS app.
//
// Reports a YYYY-MM-DD string once all three parts form a real date, and ''
// until then, so callers keep their existing `dob` string and age checks.
import { useEffect, useRef, useState } from 'react'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function toIso(day: string, month: string, year: string): string {
  const d = Number(day), m = Number(month), y = Number(year)
  if (!d || !m || year.length !== 4) return ''
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return ''
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function DateOfBirthInput({ value, onChange, idPrefix = 'dob', compact = false }: {
  value: string
  onChange: (iso: string) => void
  idPrefix?: string
  compact?: boolean
}) {
  const [initY, initM, initD] = value ? value.split('-') : ['', '', '']
  const [day, setDay] = useState(initD ? String(Number(initD)) : '')
  const [month, setMonth] = useState(initM ? String(Number(initM)) : '')
  const [year, setYear] = useState(initY ?? '')
  const monthRef = useRef<HTMLSelectElement>(null)
  const yearRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const iso = toIso(day, month, year)
    if (iso !== value) onChange(iso)
    // onChange is a fresh closure each render in every caller; the parts are what matter.
  }, [day, month, year])

  const box = `dark:bg-white/[0.05] bg-[#FFFFFF] border dark:border-white/[0.1] border-black/[0.15] rounded-2xl ${compact ? 'px-3 py-3' : 'px-4 py-4'} dark:text-white text-gray-900 text-[15px] placeholder-gray-500 focus:outline-none focus:border-brand-500/50 transition-colors`
  const label = 'block text-[12px] dark:text-white/50 text-gray-500 mb-1.5'

  return (
    <fieldset className="flex gap-2.5">
      <legend className="sr-only">Date of birth</legend>
      <div className="w-[22%]">
        <label htmlFor={`${idPrefix}-day`} className={label}>Day</label>
        <input
          id={`${idPrefix}-day`}
          inputMode="numeric"
          autoComplete="bday-day"
          placeholder="DD"
          maxLength={2}
          value={day}
          onChange={e => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 2)
            setDay(v)
            if (v.length === 2 || Number(v) > 3) monthRef.current?.focus()
          }}
          className={`${box} w-full text-center`}
        />
      </div>
      <div className="flex-1">
        <label htmlFor={`${idPrefix}-month`} className={label}>Month</label>
        <select
          id={`${idPrefix}-month`}
          ref={monthRef}
          autoComplete="bday-month"
          value={month}
          onChange={e => { setMonth(e.target.value); if (e.target.value) yearRef.current?.focus() }}
          className={`${box} w-full ${month ? '' : 'dark:text-white/40 text-gray-500'}`}
        >
          <option value="">Month</option>
          {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
        </select>
      </div>
      <div className="w-[28%]">
        <label htmlFor={`${idPrefix}-year`} className={label}>Year</label>
        <input
          id={`${idPrefix}-year`}
          ref={yearRef}
          inputMode="numeric"
          autoComplete="bday-year"
          placeholder="YYYY"
          maxLength={4}
          value={year}
          onChange={e => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
          className={`${box} w-full text-center`}
        />
      </div>
    </fieldset>
  )
}
