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
  const [oauthLoading, setOauthLoading] = useState(false)
  const [error, setError] = useState('')
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
      .single()
    router.replace(profile?.course ? '/dashboard' : '/onboarding')
  }

  const handleGoogle = async () => {
    setOauthLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    })
    if (error) {
      setError(error.message)
      posthog.capture('google_oauth_failed', { error_message: error.message })
      setOauthLoading(false)
    } else {
      posthog.capture('google_oauth_started')
    }
  }

  return (
    <main className="relative min-h-screen bg-[#080810] text-white flex items-center justify-center px-6 overflow-hidden">
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
            <h1 className="text-[36px] font-bold tracking-tight leading-tight mb-2">
              Sign in
            </h1>
            <p className="text-gray-500 mb-8">
              We'll send a code to your email.
            </p>

            {/* Google */}
            <button
              onClick={handleGoogle}
              disabled={oauthLoading}
              className="w-full flex items-center justify-center gap-3 bg-white/[0.07] border border-white/[0.1] hover:bg-white/[0.11] hover:border-white/[0.18] text-white px-5 py-4 rounded-2xl font-medium text-[15px] transition-all disabled:opacity-40 mb-4"
            >
              <GoogleIcon />
              {oauthLoading ? 'Redirecting…' : 'Continue with Google'}
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-white/[0.06]" />
              <span className="text-gray-600 text-[13px]">or</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

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
            <h1 className="text-[36px] font-bold tracking-tight leading-tight mb-2">
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
                disabled={loading || code.length < 4}
                className="py-4 rounded-2xl text-[15px] font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-25 disabled:cursor-not-allowed text-white transition-all"
              >
                {loading ? 'Verifying…' : 'Verify →'}
              </button>
            </form>

            <button
              onClick={() => { setStep('email'); setCode(''); setError('') }}
              className="mt-4 w-full text-[13px] text-gray-600 hover:text-gray-400 transition-colors"
            >
              ← Use a different email
            </button>
          </div>
        )}

        {error && (
          <p className="mt-4 text-red-400 text-[13px] text-center">{error}</p>
        )}
      </div>
    </main>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
    </svg>
  )
}
