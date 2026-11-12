'use client'

// Adds an email to a guest account ("Start without an account"), keeping the
// SAME user id: updateUser with the address, then verifyOtp with type
// 'email_change', so every lecture, term and flashcard already keyed to it
// stays put and nothing has to be migrated.
//
// Shared by the profile page's "Back up your account" box and the Pro screen,
// which asks a guest for an email before taking payment (2026-11-12): a guest
// who paid would have had Pro on an account nobody can get back into after a
// reinstall, with no address to reach them at either.

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'

export function AddEmailForm({ onLinked, via }: { onLinked: (email: string) => void; via: string }) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendCode = async () => {
    setBusy(true)
    setError(null)
    const { error } = await createClient().auth.updateUser({ email: email.trim() })
    if (error) setError(error.message)
    else setStep('code')
    setBusy(false)
  }

  // Supabase's "Change Email Address" email can carry a code, a link, or both,
  // and the link opens the default browser rather than this app, so the change
  // can complete server-side with the app still holding a session that has no
  // email on it. Refreshing the session is how the app finds out.
  const alreadyClickedLink = async () => {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    await supabase.auth.refreshSession()
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.email) {
      capture('guest_account_linked', { via: `${via}_link` })
      onLinked(user.email)
    } else {
      setError("That email hasn't been confirmed yet. Open the email and either enter the code or follow the link.")
    }
    setBusy(false)
  }

  const verify = async () => {
    setBusy(true)
    setError(null)
    // 'email_change', not 'email': attaching an address to an account that had
    // none is still an email CHANGE as far as Supabase is concerned.
    const { error } = await createClient().auth.verifyOtp({ email: email.trim(), token: code, type: 'email_change' })
    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }
    capture('guest_account_linked', { via })
    setBusy(false)
    onLinked(email.trim())
  }

  return (
    <div>
      {step === 'code' ? (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit code"
            aria-label="6-digit code"
            className="w-full dark:bg-white/[0.05] bg-white border dark:border-white/[0.1] border-black/[0.15] rounded-xl px-4 py-2.5 text-[15px] font-mono tracking-[0.2em] text-center focus:outline-none"
          />
          <p className="text-[12px] text-gray-600">
            Sent to {email}. Enter the code, or follow the link in the email and then{' '}
            <button onClick={alreadyClickedLink} disabled={busy} className="underline underline-offset-2 disabled:opacity-40">
              tap here
            </button>.
          </p>
          <div className="flex gap-2">
            <button
              onClick={verify}
              disabled={busy || code.length < 6}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-40 transition-all"
              style={{ background: 'var(--accent-solid)' }}
            >
              {busy ? 'Verifying…' : 'Confirm'}
            </button>
            <button
              onClick={() => { setStep('email'); setCode(''); setError(null) }}
              className="px-4 py-2.5 rounded-xl text-[13px] font-medium dark:bg-white/[0.06] bg-white border dark:border-white/[0.12] border-black/[0.12]"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
            aria-label="Your email"
            className="flex-1 dark:bg-white/[0.05] bg-white border dark:border-white/[0.1] border-black/[0.15] rounded-xl px-4 py-2.5 text-[14px] focus:outline-none"
          />
          <button
            onClick={sendCode}
            disabled={busy || !email.trim()}
            className="py-2.5 px-5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-40 transition-all whitespace-nowrap"
            style={{ background: 'var(--accent-solid)' }}
          >
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </div>
      )}
      {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}
    </div>
  )
}
