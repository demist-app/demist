'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

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
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/plain;charset=utf-8' })
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
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      try {
        const el = document.createElement('textarea')
        el.value = url
        el.style.position = 'fixed'
        el.style.opacity = '0'
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // clipboard unavailable — silently ignore
      }
    }
  }

  const initials = (displayName || profile?.email || '?').slice(0, 1).toUpperCase()

  if (!profile) return <div className="min-h-dvh bg-[#08080E]" />

  return (
    <main className="min-h-dvh bg-[#08080E] text-white flex flex-col nav-bottom-pad">
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Profile</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-xl mx-auto px-4 sm:px-6 py-6 space-y-4">

          {/* Avatar + user info */}
          <div
            className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 flex items-center gap-4 animate-step opacity-0"
            style={{ animationFillMode: 'forwards' }}
          >
            {/* Avatar */}
            <div className="w-[72px] h-[72px] shrink-0 rounded-full bg-gradient-to-br from-amber-700 to-amber-900 flex items-center justify-center ring-2 ring-amber-500/20 ring-offset-2 ring-offset-[#08080E] shadow-[0_0_28px_rgba(245,158,11,0.25)]">
              <span className="text-[24px] font-bold text-white select-none">{initials}</span>
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-[17px] font-bold truncate leading-tight">
                {displayName || 'No name set'}
              </p>
              <p className="text-[13px] text-white/40 truncate mt-0.5">{profile.email}</p>
            </div>
          </div>

          {/* Settings card */}
          <div
            className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 space-y-4 animate-step opacity-0"
            style={{ animationDelay: '40ms', animationFillMode: 'forwards' }}
          >
            <p className="text-[11px] font-bold tracking-[0.14em] text-white/30 uppercase mb-3">Settings</p>

            {/* Display name */}
            <div className="space-y-1.5">
              <label className="text-[12px] text-white/35 block">Display name</label>
              <Input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Your name"
                maxLength={50}
              />
            </div>

            {/* Course */}
            <div className="space-y-1.5">
              <label className="text-[12px] text-white/35 block">Course / subject</label>
              <Input
                type="text"
                value={course}
                onChange={e => setCourse(e.target.value)}
                placeholder="e.g. Molecular Biology"
                maxLength={80}
              />
            </div>

            {/* Year of study */}
            <div className="space-y-1.5">
              <label className="text-[12px] text-white/35 block">Year of study</label>
              <div className="grid grid-cols-4 gap-2">
                {YEAR_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setYear(value)}
                    className={cn(
                      'py-3 rounded-xl text-[13px] font-medium transition-all active:scale-[0.97]',
                      year === value
                        ? 'bg-amber-600 border border-amber-400/40 text-white'
                        : 'bg-white/[0.05] border border-white/[0.09] text-white/60 hover:bg-white/[0.09]'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Save button */}
            <Button
              onClick={handleSave}
              disabled={saving}
              variant={saved ? 'default' : 'default'}
              size="lg"
              className={cn(
                'w-full',
                saved && 'bg-emerald-600 hover:bg-emerald-600 shadow-none'
              )}
            >
              {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>

          {/* Anki export card */}
          {totalTerms > 0 && (
            <div
              className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden animate-step opacity-0"
              style={{ animationDelay: '80ms', animationFillMode: 'forwards' }}
            >
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[11px] font-bold tracking-[0.14em] text-white/30 uppercase mb-1">Export</p>
                    <p className="text-[15px] font-semibold text-white">Export to Anki</p>
                    <p className="text-[13px] text-white/40 mt-0.5">{totalTerms} terms ready to export</p>
                  </div>
                </div>
                <Button
                  onClick={exportToAnki}
                  disabled={exporting}
                  variant="secondary"
                  size="lg"
                  className="w-full"
                >
                  {/* Download icon */}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="w-4 h-4 shrink-0"
                  >
                    <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                  </svg>
                  {exporting ? 'Exporting…' : exported ? 'Downloaded ✓' : 'Download .txt file'}
                </Button>
              </div>

              {exported && (
                <div className="border-t border-white/[0.06] px-5 py-5 space-y-5">
                  {[
                    {
                      title: 'Android (AnkiDroid)',
                      steps: [
                        'Download the file above',
                        'Open AnkiDroid',
                        'Tap the three-dot menu in the top right',
                        'Tap Import, then select demist-flashcards.txt',
                        'Your cards will appear in a new deck',
                      ],
                    },
                    {
                      title: 'iPhone (AnkiMobile)',
                      steps: [
                        'Download the file above',
                        'Open the Downloads folder in the Files app',
                        'Tap and hold demist-flashcards.txt',
                        'Tap Share, then Copy to AnkiMobile',
                        'AnkiMobile will import the cards automatically',
                      ],
                    },
                    {
                      title: 'Desktop (Anki)',
                      steps: [
                        'Download the file above',
                        'Open Anki, click File then Import',
                        'Select demist-flashcards.txt',
                        'Set "Fields separated by" to Tab, then click Import',
                      ],
                    },
                  ].map(({ title, steps }) => (
                    <div key={title}>
                      <p className="text-[11px] font-bold tracking-[0.14em] text-amber-400/70 uppercase mb-3">{title}</p>
                      <ol className="space-y-2">
                        {steps.map((step, i) => (
                          <li key={i} className="flex items-start gap-2.5">
                            <span className="text-[11px] font-bold text-amber-500/50 shrink-0 tabular-nums mt-[2px]">{i + 1}.</span>
                            <span className="text-[12px] text-white/35">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                  <p className="text-[11px] text-white/20">Cards are tagged with your course name so they are easy to find.</p>
                </div>
              )}
            </div>
          )}

          {/* Sharing card */}
          <div
            className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 space-y-3 animate-step opacity-0"
            style={{ animationDelay: '120ms', animationFillMode: 'forwards' }}
          >
            <p className="text-[11px] font-bold tracking-[0.14em] text-white/30 uppercase mb-3">Sharing</p>

            {/* Public profile toggle */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[14px] text-white font-medium">Public profile</p>
                <p className="text-[12px] text-white/40 mt-0.5">Anyone with the link can see your stats</p>
              </div>
              <Switch
                checked={isPublic}
                onCheckedChange={togglePublic}
                aria-label="Toggle public profile"
              />
            </div>

            {isPublic && (
              <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.07] rounded-xl px-3 py-2.5">
                <span className="flex-1 text-[12px] text-white/40 truncate">
                  {typeof window !== 'undefined' ? `${window.location.origin}/u/${userId}` : `/u/${userId}`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyShareLink}
                  className="shrink-0 text-amber-400 hover:text-amber-300 hover:bg-transparent px-1 h-auto py-0 font-medium text-[12px]"
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </Button>
              </div>
            )}

            <a
              href="/stats"
              className="flex items-center justify-between w-full bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-colors duration-150 active:scale-[0.97]"
            >
              <span className="text-[14px] text-white/60">View your stats</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4 text-white/30"
              >
                <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </a>
          </div>

          {/* Danger zone — sign out */}
          <div
            className="animate-step opacity-0"
            style={{ animationDelay: '160ms', animationFillMode: 'forwards' }}
          >
            <Separator className="mb-4" />
            <Button
              onClick={handleSignOut}
              variant="ghost"
              size="lg"
              className="w-full text-white/40 hover:text-red-400 hover:bg-red-500/[0.06]"
            >
              Sign out
            </Button>
          </div>

        </div>
      </div>
    </main>
  )
}
