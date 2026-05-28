'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

interface ProfileData {
  display_name: string | null
  course: string | null
  year_of_study: number | null
  email: string
  is_public: boolean
}

const YEAR_OPTIONS = [
  { value: 1, label: 'Y1' },
  { value: 2, label: 'Y2' },
  { value: 3, label: 'Y3' },
  { value: 4, label: 'Y4' },
  { value: 5, label: 'Y5' },
  { value: 6, label: 'Y6' },
  { value: 7, label: 'Masters' },
  { value: 8, label: 'PhD' },
]


export default function Profile() {
  const router = useRouter()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [course, setCourse] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [isPublic, setIsPublic] = useState(false)
  const [copied, setCopied] = useState(false)
  const [totalTerms, setTotalTerms] = useState(0)
  const [userId, setUserId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const [
        { data: prof },
        { count: termCount },
      ] = await Promise.all([
        supabase.from('profiles').select('display_name, course, year_of_study, is_public').eq('id', user.id).maybeSingle(),
        supabase.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      ])

      const p = prof as { display_name: string | null; course: string | null; year_of_study: number | null; is_public: boolean }
      setProfile({ display_name: p?.display_name ?? null, course: p?.course ?? null, year_of_study: p?.year_of_study ?? null, email: user.email ?? '', is_public: p?.is_public ?? false })
      setDisplayName(p?.display_name ?? '')
      setCourse(p?.course ?? '')
      setYear(p?.year_of_study ?? null)
      setIsPublic(p?.is_public ?? false)
      setTotalTerms(termCount ?? 0)
    })()
  }, [])

  const handleSave = async () => {
    if (!userId) return
    setSaving(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from('profiles')
        .update({
          display_name: displayName.trim().slice(0, 60) || null,
          course: course.trim().slice(0, 100) || null,
          year_of_study: year,
          is_public: isPublic,
        })
        .eq('id', userId)
      if (error) throw error
      posthog.capture('profile_updated')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error('handleSave error:', e)
      alert('Failed to save profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleSignOut = async () => {
    await createClient().auth.signOut()
    posthog.reset()
    window.location.replace('/')
  }

  const togglePublic = async () => {
    if (!userId) return
    const next = !isPublic
    setIsPublic(next)
    await createClient().from('profiles').update({ is_public: next }).eq('id', userId)
  }

  const exportToAnki = async () => {
    setExporting(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { alert('Not signed in.'); return }
      const { data: terms, error } = await supabase
        .from('terms')
        .select('term, definition, subject')
        .eq('user_id', user.id)
        .eq('known', false)
        .order('created_at', { ascending: true })
      if (error) throw error
      if (!terms?.length) { alert('No flashcards to export yet.'); return }
      const lines = terms.map(t => {
        const tag = t.subject ? t.subject.replace(/[^\w]/g, '_').slice(0, 50) : 'Demist'
        return `${t.term}\t${t.definition}\t${tag}`
      })
      const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'demist-flashcards.txt'
      a.click()
      URL.revokeObjectURL(url)
      setExported(true)
    } catch (e) {
      console.error('exportToAnki error:', e)
      alert('Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const copyShareLink = async () => {
    if (!userId) return
    const url = `${window.location.origin}/u/${userId}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const el = document.createElement('textarea')
      el.value = url
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const initials = (displayName || profile?.email || '?').slice(0, 1).toUpperCase()

  if (!profile) return <div className="min-h-dvh bg-[#080810]" />

  return (
    <main
      className="min-h-dvh bg-[#080810] text-white flex flex-col nav-bottom-pad"
    >
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Profile</span>
      </header>

      <div className="flex-1 overflow-y-auto">
      <div className="w-full max-w-xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Avatar + name */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-600/40 to-indigo-600/30 border border-violet-500/40 flex items-center justify-center text-[24px] font-bold text-violet-300 shrink-0 shadow-[0_0_24px_rgba(139,92,246,0.2)]">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[17px] font-bold truncate">{displayName || 'No name set'}</p>
            <p className="text-[13px] text-gray-500 truncate">{profile.email}</p>
          </div>
        </div>

        {/* Anki export */}
        {totalTerms > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
            <button
              onClick={exportToAnki}
              disabled={exporting}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-all disabled:opacity-40"
            >
              <div className="text-left">
                <p className="text-[14px] text-white/80 font-medium">Export to Anki</p>
                <p className="text-[12px] text-gray-600 mt-0.5">{totalTerms} terms ready to export</p>
              </div>
              <span className="text-gray-600 text-[18px] leading-none">{exporting ? '...' : exported ? '✓' : '↓'}</span>
            </button>
            {exported && (
              <div className="border-t border-white/[0.05] px-4 py-4 space-y-5">
                <div>
                  <p className="text-[11px] font-bold tracking-[0.14em] text-violet-400/70 uppercase mb-3">Android (AnkiDroid)</p>
                  <ol className="space-y-2">
                    {[
                      'Download the file above',
                      'Open AnkiDroid',
                      'Tap the three-dot menu in the top right',
                      'Tap Import, then select demist-flashcards.txt',
                      'Your cards will appear in a new deck',
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="text-[11px] font-bold text-violet-500/50 shrink-0 tabular-nums mt-[2px]">{i + 1}.</span>
                        <span className="text-[12px] text-gray-500">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <p className="text-[11px] font-bold tracking-[0.14em] text-violet-400/70 uppercase mb-3">iPhone (AnkiMobile)</p>
                  <ol className="space-y-2">
                    {[
                      'Download the file above',
                      'Open the Downloads folder in the Files app',
                      'Tap and hold demist-flashcards.txt',
                      'Tap Share, then Copy to AnkiMobile',
                      'AnkiMobile will import the cards automatically',
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="text-[11px] font-bold text-violet-500/50 shrink-0 tabular-nums mt-[2px]">{i + 1}.</span>
                        <span className="text-[12px] text-gray-500">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <p className="text-[11px] font-bold tracking-[0.14em] text-violet-400/70 uppercase mb-3">Desktop (Anki)</p>
                  <ol className="space-y-2">
                    {[
                      'Download the file above',
                      'Open Anki, click File then Import',
                      'Select demist-flashcards.txt',
                      'Set "Fields separated by" to Tab, then click Import',
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="text-[11px] font-bold text-violet-500/50 shrink-0 tabular-nums mt-[2px]">{i + 1}.</span>
                        <span className="text-[12px] text-gray-500">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <p className="text-[11px] text-gray-700">Cards are tagged with your course name so they are easy to find.</p>
              </div>
            )}
          </div>
        )}

        {/* Edit form */}
        <div className="space-y-3">
          <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase">Settings</p>

          <div>
            <label className="text-[12px] text-gray-600 mb-1.5 block">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              maxLength={50}
              className="w-full bg-white/[0.05] border border-white/[0.1] rounded-2xl px-5 py-3.5 text-white text-[15px] placeholder-gray-700 focus:outline-none focus:border-violet-500/50 transition-all"
            />
          </div>

          <div>
            <label className="text-[12px] text-gray-600 mb-1.5 block">Course / subject</label>
            <input
              type="text"
              value={course}
              onChange={e => setCourse(e.target.value)}
              placeholder="e.g. Molecular Biology"
              maxLength={80}
              className="w-full bg-white/[0.05] border border-white/[0.1] rounded-2xl px-5 py-3.5 text-white text-[15px] placeholder-gray-700 focus:outline-none focus:border-violet-500/50 transition-all"
            />
          </div>

          <div>
            <label className="text-[12px] text-gray-600 mb-1.5 block">Year of study</label>
            <div className="grid grid-cols-4 gap-2">
              {YEAR_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setYear(value)}
                  className={`py-3 rounded-2xl text-[13px] font-medium transition-all ${
                    year === value
                      ? 'bg-violet-600 border border-violet-400/40 text-white'
                      : 'bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:bg-white/[0.09]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-4 rounded-2xl text-[15px] font-semibold transition-all ${
              saved
                ? 'bg-emerald-600 text-white'
                : 'bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40'
            }`}
          >
            {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {/* Share & leaderboard */}
        <div className="space-y-3">
          <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase">Sharing</p>

          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[14px] text-white/80 font-medium">Public profile</p>
                <p className="text-[12px] text-gray-600 mt-0.5">Anyone with the link can see your stats</p>
              </div>
              <button
                onClick={togglePublic}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${isPublic ? 'bg-violet-600' : 'bg-white/[0.1]'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${isPublic ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            {isPublic && (
              <div className="flex items-center gap-2 bg-white/[0.04] rounded-xl px-3 py-2">
                <span className="flex-1 text-[12px] text-gray-400 truncate">
                  {typeof window !== 'undefined' ? `${window.location.origin}/u/${userId}` : `/u/${userId}`}
                </span>
                <button
                  onClick={copyShareLink}
                  className="shrink-0 text-[12px] font-medium text-violet-400 hover:text-violet-300 transition-colors"
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          <a
            href="/stats"
            className="flex items-center justify-between w-full bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-3 hover:bg-white/[0.05] transition-colors duration-150 active:scale-[0.97]"
          >
            <span className="text-[14px] text-white/80">View your stats</span>
            <span className="text-gray-600 text-[18px] leading-none">›</span>
          </a>
        </div>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="w-full py-4 rounded-2xl text-[15px] font-medium bg-white/[0.03] border border-white/[0.06] text-gray-500 hover:text-red-400 hover:border-red-500/20 transition-all"
        >
          Sign out
        </button>
      </div>
      </div>
    </main>
  )
}
