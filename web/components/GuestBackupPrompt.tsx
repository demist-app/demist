'use client'

// Asks a guest to add an email, once they have something to lose.
//
// WHY. Guest accounts have no email, so there is no way back into them. A real
// user on 2026-09-22 recorded a lecture as a guest, signed out, and reappeared
// six minutes later as a fresh email account with nothing in it: same date of
// birth, course, support need and acquisition answer, zero sessions. The
// recording is still stranded on an account nobody can reach. Sign out is now
// guarded (profile/page.tsx), but that is the last line of defence, and it
// only helps someone who happens to press sign out rather than clearing their
// browser data, reinstalling, or switching machines.
//
// The upgrade itself already exists and works well: it calls updateUser with
// an email and verifies with type 'email_change', so the SAME user id is kept
// and nothing has to be migrated. It was simply only reachable from the
// profile page, which a guest has no particular reason to visit.
//
// UX DECISIONS, and why each one went this way:
//
// - AFTER the first recording, never before. They chose "start without an
//   account" deliberately. Asking at that moment argues with a decision they
//   just made; asking once they own three lectures and a glossary is offering
//   to protect something real.
// - Inline and dismissible, never a modal. This is our problem to raise, not
//   an obstacle to put in front of their work.
// - Names the actual count. "Your 3 lectures and 27 terms" is a fact about
//   them; "back up your account" is a chore.
// - Dismissal is remembered, but returns as the stake grows. Storing the
//   session count at dismissal and re-asking two lectures later means someone
//   who says no is not nagged, while someone who keeps recording is reminded
//   before the loss gets big. A permanent dismissal at one lecture would be a
//   decision made with almost nothing at stake, applied to everything after.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'

const DISMISS_KEY = 'demist_guest_backup_dismissed_at'
// How many more lectures before asking again. Two is roughly "next week" for a
// student recording a couple of lectures a week, which is long enough not to
// feel like nagging and short enough to arrive before the loss is painful.
const REASK_AFTER = 2

export function GuestBackupPrompt() {
  const [show, setShow] = useState(false)
  const [sessions, setSessions] = useState(0)
  const [terms, setTerms] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      // Only guests. A signed-in user has nothing to fix.
      if (!user || user.is_anonymous !== true) return

      const [{ count: sessionCount }, { count: termCount }] = await Promise.all([
        sb.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        sb.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      ])
      const s = sessionCount ?? 0
      if (cancelled || s < 1) return

      let dismissedAt: number | null = null
      try {
        const raw = localStorage.getItem(DISMISS_KEY)
        dismissedAt = raw === null ? null : Number(raw)
      } catch {
        // Private mode or blocked storage. Treat as never dismissed: showing
        // it again is a smaller cost than someone losing their lectures.
        dismissedAt = null
      }
      if (dismissedAt !== null && Number.isFinite(dismissedAt) && s < dismissedAt + REASK_AFTER) return

      setSessions(s)
      setTerms(termCount ?? 0)
      setShow(true)
      capture('guest_backup_prompt_shown', { sessions: s, terms: termCount ?? 0 })
    })()
    return () => { cancelled = true }
  }, [])

  if (!show) return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(sessions)) } catch { /* nothing to do */ }
    capture('guest_backup_prompt_dismissed', { sessions })
    setShow(false)
  }

  const lectures = `${sessions} ${sessions === 1 ? 'lecture' : 'lectures'}`
  const termText = terms > 0 ? ` and ${terms} ${terms === 1 ? 'term' : 'terms'}` : ''

  return (
    <div className="mx-auto w-full max-w-[680px] px-6 pt-4">
      <div className="rounded-2xl px-4 py-3.5 dark:bg-amber-500/[0.07] bg-amber-50 border dark:border-amber-500/20 border-amber-300/70">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold mb-1">
              Keep your {lectures}{termText} safe
            </p>
            <p className="text-[13px] dark:text-white/60 text-gray-700 leading-relaxed">
              You are using Demist without an account, so all of this lives on this
              computer only. Adding an email keeps it if you reinstall or switch
              machines. Your lecture audio still never leaves this device.
            </p>
          </div>
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 text-[18px] leading-none -mt-0.5 dark:text-white/30 text-gray-400 dark:hover:text-white/60 hover:text-gray-700 transition-colors"
          >
            ×
          </button>
        </div>
        <Link
          href="/profile#backup"
          onClick={() => capture('guest_backup_prompt_clicked', { sessions })}
          className="inline-block mt-3 px-4 py-2 rounded-xl bg-amber-600 hover:brightness-[1.1] text-white text-[13px] font-semibold transition-all active:scale-[0.97]"
        >
          Add an email
        </Link>
      </div>
    </div>
  )
}
