'use client'

import { createClient } from '@/lib/supabase'
import { useState } from 'react'
import posthog from 'posthog-js'

export default function Login() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

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
    } else {
      posthog.capture('google_oauth_started')
    }
    setOauthLoading(false)
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    })
    if (!error) {
      posthog.identify(email)
      posthog.capture('magic_link_requested')
      setSent(true)
    } else {
      setError(error.message)
      posthog.capture('magic_link_request_failed', { error_message: error.message })
      posthog.captureException(error)
    }
    setLoading(false)
  }

  if (sent) return (
    <main className="min-h-screen flex items-center justify-center bg-black text-white">
      <div className="text-center">
        <p className="text-xl mb-2">Check your email</p>
        <p className="text-gray-400">We sent a magic link to {email}</p>
      </div>
    </main>
  )

  return (
    <main className="min-h-screen flex items-center justify-center bg-black text-white">
      <div className="flex flex-col gap-4 w-full max-w-sm">
        <div className="mb-2">
          <h1 className="text-3xl font-bold">Sign in to Demist</h1>
          <p className="text-gray-400 mt-1">Never feel lost in a lecture again.</p>
        </div>

        <button
          onClick={handleGoogle}
          disabled={oauthLoading}
          className="flex items-center justify-center gap-3 bg-white text-black px-6 py-3 rounded-lg font-medium disabled:opacity-50 hover:bg-gray-100 transition-colors"
        >
          <GoogleIcon />
          {oauthLoading ? 'Redirecting...' : 'Continue with Google'}
        </button>

        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-gray-500 text-sm">or</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        <form onSubmit={handleMagicLink} className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-gray-800 text-white px-6 py-3 rounded-lg font-medium disabled:opacity-50 hover:bg-gray-700 transition-colors"
          >
            {loading ? 'Sending...' : 'Send magic link'}
          </button>
        </form>

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
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
