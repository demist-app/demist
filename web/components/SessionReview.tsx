'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

interface ReviewTerm { term: string; definition: string; dbId?: string }

// Feature-flagged per the P0 flashcard-drop-off investigation: this modal
// already existed and already fired correctly (session_review_completed is
// NOT the same event as flashcard_session_completed - that one lives in
// flashcards/page.tsx and was confirmed correctly wired too). The real gap
// was that this modal's whole job is curation ("which terms become
// flashcards"), and it never bridged into an actual review - the user picks
// terms, the sheet closes, and reviewing them is left to a later, easy-to-
// forget visit. flashcard_session_completed being ~0% was a genuine product
// gap, not a broken event. Key so this can be compared on real traffic
// before deciding whether to keep it on for everyone.
const REVIEW_NOW_FLAG = 'post-session-review-nudge'

// End-of-session sheet: the user chooses which detected terms become
// flashcards. Unticked terms are marked known (kept in glossary, excluded
// from study). Direct response to user feedback: no per-card save decisions
// mid-lecture; collate at the end.
export function SessionReview({ terms, sessionId, onClose }: {
  terms: ReviewTerm[]
  sessionId: string | null
  onClose: () => void
}) {
  const router = useRouter()
  const withIds = terms.filter(t => t.dbId)
  const [kept, setKept] = useState<Set<string>>(new Set(withIds.map(t => t.dbId!)))
  const [saving, setSaving] = useState(false)
  // Set once confirm() succeeds and the flag is on: swaps the sheet's body
  // for the "review these now" follow-up instead of closing immediately.
  const [offerReview, setOfferReview] = useState(false)

  const toggle = (id: string) => {
    setKept(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const confirm = async () => {
    if (saving) return
    setSaving(true)
    // Local, not the offerReview state: setState inside this same
    // synchronous run doesn't take effect until the next render, so reading
    // `offerReview` back in `finally` below would still see the old value
    // and call onClose() right after setOfferReview(true), closing the
    // sheet before the follow-up ever painted.
    let showReviewOffer = false
    try {
      const dropped = withIds.filter(t => !kept.has(t.dbId!)).map(t => t.dbId!)
      if (dropped.length) {
        await createClient().from('terms').update({ known: true }).in('id', dropped)
      }
      posthog.capture('session_review_completed', {
        total: withIds.length,
        kept: kept.size,
        dropped: dropped.length,
      })
      if (kept.size > 0 && sessionId && posthog.isFeatureEnabled(REVIEW_NOW_FLAG)) {
        posthog.capture('post_session_review_nudge_shown', { kept: kept.size })
        showReviewOffer = true
        setOfferReview(true)
      }
    } catch (e) {
      console.error('SessionReview confirm error:', e)
    } finally {
      setSaving(false)
      if (!showReviewOffer) onClose()
    }
  }

  const reviewNow = () => {
    posthog.capture('post_session_review_nudge_accepted', { kept: kept.size })
    onClose()
    router.push(`/flashcards?session=${sessionId}&from=session_review`)
  }

  const reviewLater = () => {
    posthog.capture('post_session_review_nudge_dismissed', { kept: kept.size })
    onClose()
  }

  if (!withIds.length) return null

  if (offerReview) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 dark:bg-black/60 bg-black/30"
        style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-sm dark:bg-[#0d0d1c] bg-[#FDFCF9] border dark:border-white/[0.08] border-black/[0.12] rounded-[24px] p-6 space-y-4 text-center">
          <p className="text-[18px] font-bold dark:text-white text-gray-900">
            Review {kept.size} term{kept.size !== 1 ? 's' : ''} from this lecture?
          </p>
          <p className="text-[13px] dark:text-white/60 text-gray-600 leading-relaxed">
            One quick pass while it&apos;s fresh sticks far better than coming back to it later.
          </p>
          <button
            onClick={reviewNow}
            className="w-full py-3 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150"
          >
            Review now
          </button>
          <button
            onClick={reviewLater}
            className="w-full py-2.5 rounded-2xl dark:bg-white/[0.04] bg-black/[0.04] border dark:border-white/[0.07] border-black/[0.10] text-[13px] font-medium dark:text-gray-300 text-gray-700 active:scale-[0.97] transition-all"
          >
            Later
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:px-4 dark:bg-black/60 bg-black/30"
      style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Choose your flashcards"
    >
      <div className="w-full sm:max-w-md max-h-[85dvh] flex flex-col dark:bg-[#0d0d1c] bg-[#FDFCF9] border dark:border-white/[0.09] border-black/[0.12] rounded-t-[24px] sm:rounded-[24px] p-5 sm:p-6">
        <p className="text-[18px] font-bold dark:text-white text-gray-900">
          {withIds.length} term{withIds.length !== 1 ? 's' : ''} from this lecture
        </p>
        <p className="text-[13px] dark:text-white/50 text-gray-600 mt-1 mb-4">
          Tick the ones you want as flashcards. Unticked terms stay in your glossary but won&apos;t come up in reviews.
        </p>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2 mb-4">
          {withIds.map(t => {
            const on = kept.has(t.dbId!)
            return (
              <button
                key={t.dbId}
                onClick={() => toggle(t.dbId!)}
                className={`w-full text-left flex items-start gap-3 px-4 py-3 rounded-2xl border transition-colors duration-150 ${on ? 'dark:bg-yellow-500/[0.07] bg-yellow-50 dark:border-yellow-500/30 border-yellow-600/40' : 'dark:bg-white/[0.02] bg-[#FAF9F6] dark:border-white/[0.06] border-black/[0.12] opacity-70'}`}
              >
                <span
                  className="shrink-0 w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center transition-colors"
                  style={{
                    borderColor: on ? '#D97706' : 'rgba(107,114,128,0.5)',
                    background: on ? '#D97706' : 'transparent',
                  }}
                >
                  {on && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-medium dark:text-white/90 text-gray-900">{t.term}</span>
                  <span className="block text-[12px] dark:text-white/50 text-gray-600 mt-0.5 leading-relaxed">{t.definition}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="shrink-0 flex items-center justify-between gap-3">
          <button
            onClick={() => setKept(kept.size === withIds.length ? new Set() : new Set(withIds.map(t => t.dbId!)))}
            className="text-[12px] dark:text-white/50 text-gray-600 hover:dark:text-white/80 hover:text-gray-900 transition-colors"
          >
            {kept.size === withIds.length ? 'Untick all' : 'Tick all'}
          </button>
          <button
            onClick={confirm}
            disabled={saving}
            className="px-5 py-3 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150 disabled:opacity-50"
          >
            {saving ? 'Saving…' : `Keep ${kept.size} as flashcards`}
          </button>
        </div>
      </div>
    </div>
  )
}
