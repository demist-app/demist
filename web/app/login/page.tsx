'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

type Step = 'email' | 'code'

export default function Login() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)

  // If already logged in, skip to dashboard
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) router.replace('/dashboard')
    })
  }, [])

  // Focus the code input when step changes
  useEffect(() => {
    if (step === 'code') setTimeout(() => codeRef.current?.focus(), 80)
  }, [step])

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
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
      posthog.identify(email.trim())
      posthog.capture('otp_sent')
      setStep('code')
    }
    setLoading(false)
  }

  const handleResend = async () => {
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
      setError('Invalid or expired code — check your email and try again.')
      posthog.capture('otp_verify_failed')
      setLoading(false)
      return
    }
    posthog.capture('login_success', { method: 'otp' })
    const { data: profile } = await supabase
      .from('profiles')
      .select('course')
      .eq('id', data.user!.id)
      .maybeSingle()
    router.replace(profile?.course ? '/dashboard' : '/onboarding')
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
                onChange={e => setEmail(e.target.value)}
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
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
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
                disabled={resending}
                className="text-[13px] text-gray-600 hover:text-gray-400 disabled:opacity-40 transition-colors"
              >
                {resent ? 'Code sent ✓' : resending ? 'Sending…' : 'Resend code'}
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

