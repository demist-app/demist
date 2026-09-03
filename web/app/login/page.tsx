'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { isElectronNative } from '@/lib/electronNative'
import posthog from 'posthog-js'

type Step = 'email' | 'code'

// Common disposable / temp email domains
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.info', 'guerrillamail.us',
  'guerrillamailblock.com', 'grr.la', 'sharklasers.com',
  '10minutemail.com', '10minutemail.net', '10minutemail.org',
  'tempmail.com', 'temp-mail.org', 'temp-mail.ru', 'temp-mail.io',
  'tempr.email', 'tempalias.com', 'tempinbox.com', 'temporaryemail.net',
  'tmpmail.org', 'tmpmail.net', 'tmp-mail.org',
  'throwaway.email', 'throwam.com',
  'trashmail.com', 'trashmail.net', 'trashmail.at', 'trashmail.io',
  'trashmail.me', 'trashmail.xyz', 'trashmail.org', 'trashdevil.com',
  'trashdevil.de', 'trashme.pw',
  'yopmail.com', 'yopmail.fr',
  'spam4.me', 'discard.email', 'dispostable.com',
  'mailnesia.com', 'maildrop.cc', 'mailsac.com', 'mailnull.com',
  'mailexpire.com', 'fakeinbox.com', 'binkmail.com',
  'getnada.com', 'mintemail.com', 'meltmail.com', 'getairmail.com',
  'spamgourmet.com', 'spamgourmet.net', 'spamgourmet.org',
  'spambox.us', 'spamex.com', 'spamfree24.org', 'spam.la',
  'mytemp.email', 'emailfake.com', 'inboxbear.com', 'tempail.com',
  'burnermail.io', 'stopspam.app', 'noref.in', 'willselfdestruct.com',
  'privacy.net', 'filzmail.com', 'spamgob.com', 'spamhereplease.com',
  'cool.fr.nf', 'jetable.fr.nf', 'spamtraps.net',
])

// Returns an error string or null if valid
function validateEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  // RFC-ish format check: local@domain.tld
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return 'Enter a valid email address.'
  }
  const domain = email.split('@')[1]
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return 'Temporary email addresses aren\'t supported. Use a real email.'
  }
  return null
}

export default function Login() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)
  // Desktop only. On the web an account is the whole point (it syncs across
  // the machines someone actually uses), but the desktop app processes
  // everything on-device and never sends a lecture anywhere - so demanding an
  // email before it will do anything is asking for a signup in exchange for
  // nothing the user can see. Resolved in an effect rather than inline because
  // window.demistNative does not exist during server rendering.
  const [isDesktop, setIsDesktop] = useState(false)
  const [guestLoading, setGuestLoading] = useState(false)

  useEffect(() => {
    setIsDesktop(isElectronNative())
    createClient().auth.getSession().then(({ data }) => {
      if (data.session?.user) router.replace('/dashboard')
    })
  }, [])

  // Start with no email at all.
  //
  // signInAnonymously mints a real user with a real auth.uid() and no email,
  // which is why this needs no schema or policy work: every RLS policy in
  // backend/supabase/migrations is `auth.uid() = user_id`, and the
  // on_auth_user_created trigger inserts profiles(id) without touching email.
  // Sessions, terms, flashcards, glossary, streaks and stats all just work.
  //
  // The catch, and it is a real one: with no email there is no recovery. If
  // this device's storage is cleared the account and everything in it is gone.
  // Settings offers adding an email later, which UPGRADES this same user id
  // rather than creating a second account, so nothing has to be migrated.
  const handleGuestStart = async () => {
    setGuestLoading(true)
    setError('')
    const supabase = createClient()
    const { data, error } = await supabase.auth.signInAnonymously()
    if (error || !data.session) {
      // The most likely cause by far is anonymous sign-ins being switched off
      // for the Supabase project, which is a dashboard setting and produces a
      // 422 that means nothing to a user.
      console.error('anonymous sign-in failed:', error)
      setError("Couldn't start without an account. Try signing in with an email instead.")
      posthog.capture('guest_start_failed', { error_message: error?.message })
      setGuestLoading(false)
      return
    }
    posthog.capture('guest_start')
    // Same routing the email path uses: straight to onboarding, since a brand
    // new anonymous user has no course or year yet.
    router.replace('/onboarding')
  }

  useEffect(() => {
    if (step === 'code') setTimeout(() => codeRef.current?.focus(), 80)
  }, [step])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    const validationError = validateEmail(email)
    if (validationError) { setError(validationError); return }
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    })
    if (error) {
      setError(error.message)
      posthog.capture('otp_send_failed', { error_message: error.message })
    } else {
      posthog.capture('otp_sent')
      setStep('code')
      setResendCooldown(60)
    }
    setLoading(false)
  }

  const handleResend = async () => {
    if (resendCooldown > 0) return
    setResending(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    })
    setResending(false)
    if (error) {
      setError(error.message)
    } else {
      setResent(true)
      setResendCooldown(60)
      setTimeout(() => setResent(false), 3000)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (code.length < 6) return
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })
    if (error) {
      setError('Invalid or expired code. Check your email and try again.')
      posthog.capture('otp_verify_failed')
      setLoading(false)
      return
    }
    // The user id ONLY. This used to pass { email }, which sent every user's
    // email address to PostHog as a person property while the privacy policy
    // stated in two places that analytics events contain no personal data.
    // The email bought nothing analytically - the id already ties a person's
    // events together - so removing it is a straight improvement over
    // rewriting the policy to admit to it.
    posthog.identify(data.user!.id)
    posthog.capture('login_success', { method: 'otp' })
    const { data: profile } = await supabase
      .from('profiles')
      .select('course, year_of_study')
      .eq('id', data.user!.id)
      .maybeSingle()
    router.replace((profile?.course || profile?.year_of_study) ? '/dashboard' : '/onboarding')
  }

  return (
    <main className="relative min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex items-center justify-center px-6 overflow-y-auto py-12">
      {/* Ambient glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[700px] h-[700px] rounded-full dark:bg-yellow-600/[0.07] bg-yellow-500/[0.12] blur-[130px]" />
      </div>

      <div className="relative w-full max-w-[400px]">
        <p className="text-[11px] font-bold tracking-[0.22em] uppercase mb-10" style={{ color: 'var(--accent)' }}>
          Demist
        </p>

        {/* ── Email step ── */}
        {step === 'email' && (
          <div className="animate-step">
            <p className="text-[12px] dark:text-white/40 text-gray-500 mb-3">Real-time term detection for lectures</p>
            <h1 className="text-[30px] sm:text-[36px] font-bold tracking-tight leading-tight mb-2">
              {isDesktop ? 'Get started' : 'Sign in'}
            </h1>
            <p className="text-gray-700 mb-8">
              {isDesktop
                ? 'Demist transcribes on this computer, so your lecture audio never leaves it. You don’t need an account to use it.'
                : 'We’ll send a code to your email, no password needed.'}
            </p>

            {isDesktop && (
              <div className="mb-7">
                <button
                  type="button"
                  onClick={handleGuestStart}
                  disabled={guestLoading}
                  className="w-full py-4 rounded-2xl text-[15px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.97]"
                  style={{ background: 'var(--accent)' }}
                >
                  {guestLoading ? 'Setting up…' : 'Start without an account'}
                </button>
                <p className="text-[12px] text-gray-500 mt-2.5 leading-relaxed">
                  Everything stays on this computer. You can add an email later in Settings
                  to keep your cards if you reinstall or switch machines.
                </p>
                <div className="flex items-center gap-3 mt-7 mb-1">
                  <span className="h-px flex-1 dark:bg-white/[0.09] bg-black/[0.09]" />
                  <span className="text-[11px] uppercase tracking-[0.15em] text-gray-500">or</span>
                  <span className="h-px flex-1 dark:bg-white/[0.09] bg-black/[0.09]" />
                </div>
              </div>
            )}

            {isDesktop && (
              <p className="text-[13px] text-gray-600 mb-3">
                Already have an account? Sign in to pull your cards onto this computer.
              </p>
            )}

            <form onSubmit={handleSendCode} className="flex flex-col gap-3">
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); if (error) setError('') }}
                placeholder="your@email.com"
                // Not on desktop: autofocusing the email field there drags
                // attention straight past the "no account needed" option that
                // is meant to be the answer for most people.
                autoFocus={!isDesktop}
                required
                className="w-full dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.1] border-black/[0.15] rounded-2xl px-5 py-4 dark:text-white text-gray-900 text-[15px] placeholder-gray-500 focus:outline-none transition-all"
                style={{ '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
                onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.target.style.borderColor = '')}
              />
              {/* Secondary on desktop: "start without an account" is the
                  primary action there, and two accent-filled buttons would
                  give the user no steer at all. */}
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className={`py-4 rounded-2xl text-[15px] font-semibold disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-[0.97] ${
                  isDesktop
                    ? 'dark:bg-white/[0.06] bg-[#F6F5F2] border dark:border-white/[0.12] border-black/[0.15] dark:text-white text-gray-900'
                    : 'text-white'
                }`}
                style={isDesktop ? undefined : { background: 'var(--accent)' }}
              >
                {loading ? 'Sending…' : 'Send code'}
              </button>
            </form>
          </div>
        )}

        {/* ── Code step ── */}
        {step === 'code' && (
          <div className="animate-step">
            <h1 className="text-[30px] sm:text-[36px] font-bold tracking-tight leading-tight mb-2">
              Check your email
            </h1>
            <p className="text-gray-700 mb-1">
              We sent a sign-in code to
            </p>
            <p className="font-medium mb-2">{email}</p>
            {/* The actual fix for "clicked get started, never came back": that
                drop-off looks identical to someone changing their mind, but a
                brand-new sending domain has no reputation yet, so a real share
                of first codes land in spam. Telling someone the email "didn't
                arrive" AFTER they've already given up does nothing - this has
                to be read before that happens, right where they're staring at
                an empty inbox. */}
            <p className="text-[13px] text-gray-600 mb-8">
              Not there in a minute? Check your spam or junk folder.
            </p>

            <form onSubmit={handleVerifyCode} className="flex flex-col gap-3">
              <input
                ref={codeRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onPaste={e => {
                  e.preventDefault()
                  const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
                  setCode(pasted)
                }}
                placeholder="000000"
                className="w-full dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.1] border-black/[0.15] rounded-2xl px-5 py-4 dark:text-white text-gray-900 text-[22px] font-mono tracking-[0.3em] text-center placeholder-gray-500 focus:outline-none transition-all"
                onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.target.style.borderColor = '')}
              />
              <button
                type="submit"
                disabled={loading || code.length < 6}
                className="py-4 rounded-2xl text-[15px] font-semibold text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-[0.97]"
                style={{ background: 'var(--accent)' }}
              >
                {loading ? 'Verifying…' : 'Verify →'}
              </button>
            </form>

            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => { setStep('email'); setCode(''); setError('') }}
                className="text-[13px] text-gray-600 hover:text-gray-600 transition-colors"
              >
                ← Different email
              </button>
              <button
                onClick={handleResend}
                disabled={resending || resendCooldown > 0}
                className="text-[13px] text-gray-600 hover:text-gray-600 disabled:opacity-40 transition-colors"
              >
                {resent ? 'Code sent ✓' : resending ? 'Sending…' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 text-red-400 text-[13px] text-center" role="alert">{error}</p>
        )}

        <p className="text-[12px] text-gray-600 text-center mt-8">
          By signing in you agree to our{' '}
          <Link href="/terms" className="hover:text-gray-500 transition-colors underline underline-offset-2">Terms of Service</Link>
          {' '}and{' '}
          <Link href="/privacy" className="hover:text-gray-500 transition-colors underline underline-offset-2">Privacy Policy</Link>.
        </p>
      </div>
    </main>
  )
}
