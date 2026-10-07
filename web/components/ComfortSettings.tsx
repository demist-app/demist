'use client'

// Settings > Reading and comfort. See lib/comfortPrefs.ts for what each one
// does and why progress games default to off.

import { FONT_OPTIONS, TINT_OPTIONS, setComfort, useComfort, type Spacing } from '@/lib/comfortPrefs'

const chip = (active: boolean) =>
  `py-3 px-3 rounded-2xl text-[13px] font-medium transition-all ${
    active
      ? 'bg-brand-600 border border-brand-400/40 text-white'
      : 'dark:bg-white/[0.05] bg-[#F8F6FB] border dark:border-white/[0.08] border-black/[0.13] text-gray-600 dark:hover:bg-white/[0.09] hover:bg-brand-50'
  }`

export function ComfortSettings() {
  const prefs = useComfort()

  return (
    <>
      <div>
        <label className="text-[12px] text-gray-600 mb-1.5 block">Font</label>
        <div className="grid grid-cols-3 gap-2">
          {FONT_OPTIONS.map(f => (
            <button
              key={f.value}
              onClick={() => setComfort({ font: f.value })}
              aria-pressed={prefs.font === f.value}
              className={chip(prefs.font === f.value)}
              style={{ fontFamily: f.sample }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-gray-500 mt-1.5">Atkinson Hyperlegible and Lexend are designed to be easier to read, especially with dyslexia.</p>
      </div>

      <div>
        <label className="text-[12px] text-gray-600 mb-1.5 block">Line spacing</label>
        <div className="grid grid-cols-2 gap-2">
          {(['normal', 'relaxed'] as Spacing[]).map(s => (
            <button key={s} onClick={() => setComfort({ spacing: s })} aria-pressed={prefs.spacing === s} className={chip(prefs.spacing === s)}>
              {s === 'normal' ? 'Normal' : 'Relaxed'}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-gray-500 mt-1.5">More space between lines and words in the transcript, definitions and summaries.</p>
      </div>

      <div>
        <label className="text-[12px] text-gray-600 mb-1.5 block">Colour tint</label>
        <div className="grid grid-cols-5 gap-2">
          {TINT_OPTIONS.map(t => (
            <button
              key={t.value}
              onClick={() => setComfort({ tint: t.value })}
              aria-pressed={prefs.tint === t.value}
              aria-label={`${t.label} tint`}
              className={`${chip(prefs.tint === t.value)} flex flex-col items-center gap-1.5 !px-1`}
            >
              <span
                className="w-6 h-6 rounded-full border dark:border-white/20 border-black/15"
                style={{ background: t.value === 'none' ? 'linear-gradient(135deg, transparent 45%, rgba(239,68,68,.55) 47%, rgba(239,68,68,.55) 53%, transparent 55%)' : t.swatch }}
              />
              <span className="text-[11px]">{t.label}</span>
            </button>
          ))}
        </div>
        <p className="text-[12px] text-gray-500 mt-1.5">Tints the whole screen, like a coloured reading overlay. Works in light mode.</p>
      </div>

      <div>
        <label className="text-[12px] text-gray-600 mb-1.5 block">Streaks</label>
        <button
          role="switch"
          aria-checked={prefs.showProgress}
          onClick={() => setComfort({ showProgress: !prefs.showProgress })}
          className="w-full flex items-center justify-between gap-3 py-3 px-4 rounded-2xl dark:bg-white/[0.05] bg-[#F8F6FB] border dark:border-white/[0.08] border-black/[0.13] text-left"
        >
          <span className="text-[13px] dark:text-white/80 text-gray-800">{prefs.showProgress ? 'Shown' : 'Hidden'}</span>
          <span className={`relative w-10 h-6 rounded-full transition-colors ${prefs.showProgress ? 'bg-brand-600' : 'dark:bg-white/[0.15] bg-black/[0.15]'}`}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${prefs.showProgress ? 'left-[18px]' : 'left-0.5'}`} />
          </span>
        </button>
        <p className="text-[12px] text-gray-500 mt-1.5">Off unless you turn it on. Some people find streaks motivating; others find them stressful.</p>
      </div>
    </>
  )
}
