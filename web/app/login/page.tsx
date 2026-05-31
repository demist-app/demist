'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
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

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) router.replace('/dashboard')
    })
  }, [])

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
    posthog.identify(data.user!.id, { email: email.trim() })
    posthog.capture('login_success', { method: 'otp' })
    const { data: profile } = await supabase
      .from('profiles')
      .select('course, year_of_study')
      .eq('id', data.user!.id)
      .maybeSingle()
    router.replace((profile?.course || profile?.year_of_study) ? '/dashboard' : '/onboarding')
  }

  return (
    <main className="relative min-h-dvh bg-[#080810] text-white flex items-center justify-center px-6 overflow-y-auto py-12">
      {/* Ambient glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[700px] h-[700px] rounded-full bg-violet-600/[0.07] blur-[130px]" />
      </div>

      <div className="relative w-full max-w-[400px]">
        <p className="text-[11px] font-bold tracking-[0.22em] text-violet-400/70 uppercase mb-10">
          Demist
        </p>

        {/* ── Email step ── */}
        {step === 'email' && (
          <div className="animate-step">
            <h1 className="text-[30px] sm:text-[36px] font-bold tracking-tight leading-tight mb-2">
              Sign in
            </h1>
            <p className="text-gray-500 mb-8">
              We'll send a code to your email.
            </p>

            <form onSubmit={handleSendCode} className="flex flex-col gap-3">
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); if (error) setError('') }}
                placeholder="your@email.com"
                autoFocus
                required
                className="w-full bg-white/[0.05] border border-white/[0.1] rounded-2xl px-5 py-4 text-white text-[15px] placeholder-gray-600 focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.07] transition-all"
              />
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="py-4 rounded-2xl text-[15px] font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-25 disabled:cursor-not-allowed text-white transition-all"
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
            <p className="text-gray-500 mb-1">
              We sent a sign-in code to
            </p>
            <p className="text-white font-medium mb-8">{email}</p>

            <form onSubmit={handleVerifyCode} className="flex flex-col gap-3">
              <input
                ref={codeRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full bg-white/[0.05] border border-white/[0.1] rounded-2xl px-5 py-4 text-white text-[22px] font-mono tracking-[0.3em] text-center placeholder-gray-700 focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.07] transition-all"
              />
              <button
                type="submit"
                disabled={loading || code.length < 6}
                className="py-4 rounded-2xl text-[15px] font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-25 disabled:cursor-not-allowed text-white transition-all"
              >
                {loading ? 'Verifying…' : 'Verify →'}
              </button>
            </form>

            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => { setStep('email'); setCode(''); setError('') }}
                className="text-[13px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                ← Different email
              </button>
              <button
                onClick={handleResend}
                disabled={resending || resendCooldown > 0}
                className="text-[13px] text-gray-600 hover:text-gray-400 disabled:opacity-40 transition-colors"
              >
                {resent ? 'Code sent ✓' : resending ? 'Sending…' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 text-red-400 text-[13px] text-center">{error}</p>
        )}
      </div>
    </main>
  )
}
