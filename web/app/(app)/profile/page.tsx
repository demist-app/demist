'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { capture, reset } from '@/lib/analytics'
import { ConsentManager } from '@/components/ConsentUnlock'
import { useEntitlements } from '@/lib/entitlements'
import { PaywallModal } from '@/components/PaywallModal'
import { useNativeTranslate } from '@/lib/useNativeTranslate'
import { FontScale, FONT_SCALE_LABELS, getFontScale, setFontScale } from '@/lib/fontScale'

interface ProfileData {
  display_name: string | null
  course: string | null
  year_of_study: number | null
  support_need: SupportNeed | null
  translate_to: TranslateTo | null
  email: string
  is_public: boolean
}

const YEAR_OPTIONS = [
  { value: 1, label: 'Y1' },
  { value: 2, label: 'Y2' },
  { value: 3, label: 'Y3' },
  { value: 4, label: 'Y4' },
  { value: 7, label: 'Masters' },
  { value: 8, label: 'PhD' },
]

type SupportNeed = 'hearing' | 'dyslexia' | 'attention' | 'language' | 'other'

const SUPPORT_NEED_OPTIONS: { value: SupportNeed; label: string }[] = [
  { value: 'hearing', label: 'Hearing' },
  { value: 'dyslexia', label: 'Reading or dyslexia' },
  { value: 'attention', label: 'Focus or attention' },
  { value: 'language', label: 'English isn’t my first language' },
  { value: 'other', label: 'Prefer not to say' },
]

type TranslateTo = 'zh' | 'ar' | 'hi' | 'es' | 'fr'

const TRANSLATE_OPTIONS: { value: TranslateTo; label: string }[] = [
  { value: 'zh', label: 'Mandarin' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
]


export default function Profile() {
  const router = useRouter()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [course, setCourse] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [supportNeed, setSupportNeed] = useState<SupportNeed | null>(null)
  const [translateTo, setTranslateTo] = useState<TranslateTo | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [isPublic, setIsPublic] = useState(false)
  const [copied, setCopied] = useState(false)
  const [totalTerms, setTotalTerms] = useState(0)
  const [recordingMins, setRecordingMins] = useState(0)
  const [longestStreak, setLongestStreak] = useState(0)
  const [userId, setUserId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(false)
  const { limits } = useEntitlements()
  const [paywall, setPaywall] = useState<string | null>(null)
  const localTranslate = useNativeTranslate()
  const [textSize, setTextSize] = useState<FontScale>('md')
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string>('')
  const [micLabelsUnlocked, setMicLabelsUnlocked] = useState(false)

  // Account deletion state
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return
      setUserId(user.id)

      const [
        { data: prof },
        { count: termCount },
        { data: sessionRows },
      ] = await Promise.all([
        supabase.from('profiles').select('display_name, course, year_of_study, support_need, translate_to, is_public').eq('id', user.id).maybeSingle(),
        supabase.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('sessions').select('started_at, ended_at').eq('user_id', user.id),
      ])

      const p = prof as { display_name: string | null; course: string | null; year_of_study: number | null; support_need: SupportNeed | null; translate_to: TranslateTo | null; is_public: boolean }
      setProfile({ display_name: p?.display_name ?? null, course: p?.course ?? null, year_of_study: p?.year_of_study ?? null, support_need: p?.support_need ?? null, translate_to: p?.translate_to ?? null, email: user.email ?? '', is_public: p?.is_public ?? false })
      setDisplayName(p?.display_name ?? '')
      setCourse(p?.course ?? '')
      setYear(p?.year_of_study ?? null)
      setSupportNeed(p?.support_need ?? null)
      setTranslateTo(p?.translate_to ?? null)
      if (p?.translate_to) localTranslate.start(p.translate_to)
      setIsPublic(p?.is_public ?? false)
      setTotalTerms(termCount ?? 0)

      const rows = (sessionRows ?? []) as { started_at: string; ended_at: string | null }[]
      const mins = rows.reduce((sum, s) => {
        if (!s.ended_at) return sum
        const m = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000
        return m > 0 && m < 600 ? sum + m : sum
      }, 0)
      setRecordingMins(Math.round(mins))

      // Longest streak ever, computed from session day history
      const days = [...new Set(rows.map(s => { const d = new Date(s.started_at); d.setHours(0, 0, 0, 0); return d.getTime() }))].sort((a, b) => a - b)
      let longest = 0; let run = 0; let prevDay = 0
      for (const day of days) {
        run = day - prevDay === 86400000 ? run + 1 : 1
        if (run > longest) longest = run
        prevDay = day
      }
      setLongestStreak(longest)
    })()
  }, [])

  // Text size and microphone choice are device-local (localStorage), not
  // profile columns: they depend on the screen/hardware someone's using.
  useEffect(() => {
    setTextSize(getFontScale())
    setSelectedMicId(localStorage.getItem('demist_mic_device_id') ?? '')
    listMicDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', listMicDevices)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', listMicDevices)
  }, [])

  const listMicDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const devices = await navigator.mediaDevices.enumerateDevices()
    const mics = devices.filter(d => d.kind === 'audioinput')
    setMicDevices(mics)
    if (mics.some(d => d.label)) setMicLabelsUnlocked(true)
  }

  // Device labels are blank until the mic permission has been granted at
  // least once. A short-lived getUserMedia call unlocks them without
  // recording anything.
  const unlockMicLabels = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
      await listMicDevices()
    } catch {
      alert('Microphone access is needed to show device names.')
    }
  }

  const handleMicChange = (deviceId: string) => {
    setSelectedMicId(deviceId)
    if (deviceId) localStorage.setItem('demist_mic_device_id', deviceId)
    else localStorage.removeItem('demist_mic_device_id')
  }

  const handleTextSizeChange = (scale: FontScale) => {
    setTextSize(scale)
    setFontScale(scale)
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE' || deleting) return
    setDeleting(true)
    setDeleteError(null)
    capture('account_deletion_initiated')
    try {
      const supabase = createClient()
      const { error } = await supabase.rpc('delete_user_data')
      if (error) throw error
      await supabase.auth.signOut()
      reset()
      window.location.replace('/')
    } catch (e) {
      console.error('handleDeleteAccount error:', e)
      setDeleteError('Could not delete your account. Please try again or email hello@demist.app.')
      setDeleting(false)
    }
  }

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
          support_need: supportNeed,
          translate_to: translateTo,
          is_public: isPublic,
        })
        .eq('id', userId)
      if (error) throw error
      capture('profile_updated')
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
    reset()
    window.location.replace('/')
  }

  const togglePublic = async () => {
    if (!userId) return
    const next = !isPublic
    setIsPublic(next)
    await createClient().from('profiles').update({ is_public: next }).eq('id', userId)
  }

  const exportToAnki = async () => {
    if (!limits.ankiExport) { setPaywall('anki_export'); return }
    setExporting(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
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
        // clipboard unavailable: silently ignore
      }
    }
  }

  const initials = (displayName || profile?.email || '?').slice(0, 1).toUpperCase()

  if (!profile) return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] flex flex-col nav-bottom-pad">
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b dark:border-white/[0.05] border-black/[0.06]">
        <span className="font-semibold text-[15px] dark:text-white text-gray-900">Profile</span>
      </header>
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-8 w-full max-w-lg mx-auto animate-pulse">
        {/* Avatar */}
        <div className="flex flex-col items-center gap-3 mb-10">
          <div className="w-20 h-20 rounded-full dark:bg-white/[0.07] bg-[#EFEDE7]" />
          <div className="h-3 w-28 dark:bg-white/[0.05] bg-[#F6F5F2] rounded-full" />
          <div className="h-2.5 w-36 dark:bg-white/[0.04] bg-[#FAF9F6] rounded-full" />
        </div>
        {/* Fields */}
        {[0,1,2].map(i => (
          <div key={i} className="mb-5">
            <div className="h-2.5 w-16 dark:bg-white/[0.05] bg-[#F6F5F2] rounded-full mb-2.5" />
            <div className="h-12 dark:bg-white/[0.04] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.16] rounded-2xl" />
          </div>
        ))}
        <div className="h-12 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-2xl mt-6" />
      </div>
    </main>
  )

  return (
    <main
      className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col nav-bottom-pad"
    >
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-yellow-700/[0.05] blur-[120px]" />
      </div>
      <header className="sm:hidden relative z-10 shrink-0 flex items-center px-6 h-14 border-b dark:border-white/[0.05] border-black/[0.06]">
        <span className="font-semibold tracking-tight text-[15px]">Profile</span>
      </header>

      <div className="flex-1 overflow-y-auto">
      <div className="w-full max-w-xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Avatar + name */}
        <div className="flex items-center gap-4 animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-yellow-600/40 to-amber-600/30 border border-yellow-500/40 flex items-center justify-center text-[24px] font-bold dark:text-yellow-300 text-yellow-700 shrink-0 shadow-[0_0_24px_rgba(161,98,7,0.22)] dark:shadow-[0_0_24px_rgba(251,191,36,0.22)]">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[17px] font-bold truncate">{displayName || 'No name set'}</p>
            <p className="text-[13px] text-gray-700 truncate">{profile.email}</p>
          </div>
        </div>

        {/* All-time stats */}
        <div className="grid grid-cols-3 gap-2 animate-step opacity-0" style={{ animationDelay: '20ms', animationFillMode: 'forwards' }}>
          {[
            { value: totalTerms.toLocaleString(), label: totalTerms === 1 ? 'term learned' : 'terms learned' },
            { value: recordingMins >= 60 ? `${Math.floor(recordingMins / 60)}h ${recordingMins % 60}m` : `${recordingMins}m`, label: 'recorded' },
            { value: longestStreak.toLocaleString(), label: 'longest streak' },
          ].map(({ value, label }) => (
            <div key={label} className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl px-3 py-4 text-center">
              <p className="text-[20px] font-bold leading-none dark:text-amber-400 text-amber-700 tabular-nums">{value}</p>
              <p className="text-[11px] text-gray-600 mt-1.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Anki export */}
        {totalTerms > 0 && (
          <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl overflow-hidden animate-step opacity-0" style={{ animationDelay: '30ms', animationFillMode: 'forwards' }}>
            <button
              onClick={exportToAnki}
              disabled={exporting}
              className="w-full flex items-center justify-between px-4 py-3 hover:dark:bg-white/[0.03] bg-[#FAF9F6] transition-all disabled:opacity-40"
            >
              <div className="text-left">
                <p className="text-[14px] dark:text-white/80 text-gray-800 font-medium">Export to Anki</p>
                <p className="text-[12px] text-gray-600 mt-0.5">{totalTerms} concepts ready to export</p>
              </div>
              <span className="text-gray-600 text-[18px] leading-none">{exporting ? '...' : exported ? '✓' : '↓'}</span>
            </button>
            {exported && (
              <div className="border-t dark:border-white/[0.05] border-black/[0.06] px-4 py-4 space-y-5">
                <div>
                  <p className="text-[11px] font-bold tracking-[0.14em] dark:text-yellow-400 text-yellow-700/70 uppercase mb-3">Android (AnkiDroid)</p>
                  <ol className="space-y-2">
                    {[
                      'Download the file above',
                      'Open AnkiDroid',
                      'Tap the three-dot menu in the top right',
                      'Tap Import, then select demist-flashcards.txt',
                      'Your cards will appear in a new deck',
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="text-[11px] font-bold text-yellow-500/50 shrink-0 tabular-nums mt-[2px]">{i + 1}.</span>
                        <span className="text-[12px] text-gray-700">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <p className="text-[11px] font-bold tracking-[0.14em] dark:text-yellow-400 text-yellow-700/70 uppercase mb-3">iPhone (AnkiMobile)</p>
                  <ol className="space-y-2">
                    {[
                      'Download the file above',
                      'Open the Downloads folder in the Files app',
                      'Tap and hold demist-flashcards.txt',
                      'Tap Share, then Copy to AnkiMobile',
                      'AnkiMobile will import the cards automatically',
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="text-[11px] font-bold text-yellow-500/50 shrink-0 tabular-nums mt-[2px]">{i + 1}.</span>
                        <span className="text-[12px] text-gray-700">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <p className="text-[11px] font-bold tracking-[0.14em] dark:text-yellow-400 text-yellow-700/70 uppercase mb-3">Desktop (Anki)</p>
                  <ol className="space-y-2">
                    {[
                      'Download the file above',
                      'Open Anki, click File then Import',
                      'Select demist-flashcards.txt',
                      'Set "Fields separated by" to Tab, then click Import',
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="text-[11px] font-bold text-yellow-500/50 shrink-0 tabular-nums mt-[2px]">{i + 1}.</span>
                        <span className="text-[12px] text-gray-700">{step}</span>
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
        <div className="space-y-3 animate-step opacity-0" style={{ animationDelay: '60ms', animationFillMode: 'forwards' }}>
          <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase">Settings</p>

          <div>
            <label className="text-[12px] text-gray-600 mb-1.5 block">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              maxLength={50}
              className="w-full dark:bg-white/[0.05] bg-[#F6F5F2] border border-white/[0.1] rounded-2xl px-5 py-3.5 dark:text-white text-gray-900 text-[15px] placeholder-gray-700 focus:outline-none focus:border-yellow-500/50 transition-all"
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
              className="w-full dark:bg-white/[0.05] bg-[#F6F5F2] border border-white/[0.1] rounded-2xl px-5 py-3.5 dark:text-white text-gray-900 text-[15px] placeholder-gray-700 focus:outline-none focus:border-yellow-500/50 transition-all"
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
                      ? 'bg-yellow-600 border border-yellow-400/40 dark:text-white text-gray-900'
                      : 'dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] text-gray-600 hover:bg-white/[0.09]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[12px] text-gray-600 mb-1.5 block">Does anything make lectures harder to follow?</label>
            <div className="grid grid-cols-2 gap-2">
              {SUPPORT_NEED_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setSupportNeed(value)}
                  className={`py-3 px-3 rounded-2xl text-[13px] font-medium transition-all ${
                    supportNeed === value
                      ? 'bg-yellow-600 border border-yellow-400/40 dark:text-white text-gray-900'
                      : 'dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] text-gray-600 hover:bg-white/[0.09]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[12px] text-gray-600 mb-1.5 block">Translate definitions into</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setTranslateTo(null)}
                className={`py-3 px-3 rounded-2xl text-[13px] font-medium transition-all ${
                  translateTo === null
                    ? 'bg-yellow-600 border border-yellow-400/40 dark:text-white text-gray-900'
                    : 'dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] text-gray-600 hover:bg-white/[0.09]'
                }`}
              >
                English only
              </button>
              {TRANSLATE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => {
                    setTranslateTo(value)
                    // No-op in unsupported browsers; Chrome downloads its own
                    // model silently in the background, nothing for us to gate.
                    localTranslate.start(value)
                  }}
                  className={`py-3 px-3 rounded-2xl text-[13px] font-medium transition-all ${
                    translateTo === value
                      ? 'bg-yellow-600 border border-yellow-400/40 dark:text-white text-gray-900'
                      : 'dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] text-gray-600 hover:bg-white/[0.09]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-gray-500 mt-1.5">Shows a one-line translation under each term&apos;s definition, and a live bilingual transcript in browsers with on-device translation (Chrome). Runs on-device automatically where supported: nothing to download or configure. Elsewhere, definitions are translated by the same OpenAI service that already generates them; the live bilingual transcript needs on-device support either way.</p>
            {translateTo && localTranslate.status === 'downloading' && (
              <p className="text-[12px] text-gray-600 mt-1.5">Chrome is downloading its on-device translation model… {localTranslate.progress}%, a one-time download shared by every site, not just Demist. Cloud translation covers definitions in the meantime.</p>
            )}
            {translateTo && localTranslate.status === 'error' && (
              <p className="text-[12px] text-red-400 mt-1.5">On-device translation isn&apos;t available right now. Term definitions are still translated in the cloud.</p>
            )}
          </div>

          <div>
            <label className="text-[12px] text-gray-600 mb-1.5 block">Microphone</label>
            {micDevices.length > 0 ? (
              <select
                value={selectedMicId}
                onChange={e => handleMicChange(e.target.value)}
                className="w-full dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] rounded-2xl px-4 py-3 dark:text-white text-gray-900 text-[14px] focus:outline-none focus:border-yellow-500/50 transition-colors"
              >
                <option value="">System default</option>
                {micDevices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
                ))}
              </select>
            ) : (
              <p className="text-[12px] text-gray-600">No microphones detected yet.</p>
            )}
            {!micLabelsUnlocked && (
              <button
                onClick={unlockMicLabels}
                className="text-[12px] dark:text-yellow-400 text-yellow-700 hover:opacity-80 transition-opacity mt-1.5"
              >
                Grant access to see device names
              </button>
            )}
            <p className="text-[12px] text-gray-500 mt-1.5">Which input Demist records from. Applies the next time you start recording.</p>
          </div>

          <div>
            <label className="text-[12px] text-gray-600 mb-1.5 block">Text size</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(FONT_SCALE_LABELS) as FontScale[]).map(scale => (
                <button
                  key={scale}
                  onClick={() => handleTextSizeChange(scale)}
                  className={`py-3 rounded-2xl text-[13px] font-medium transition-all ${
                    textSize === scale
                      ? 'bg-yellow-600 border border-yellow-400/40 dark:text-white text-gray-900'
                      : 'dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] text-gray-600 hover:bg-white/[0.09]'
                  }`}
                >
                  {FONT_SCALE_LABELS[scale]}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-gray-500 mt-1.5">Size of the live transcript, definitions, and summaries.</p>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-4 rounded-2xl text-[15px] font-semibold transition-all ${
              saved
                ? 'bg-emerald-600 dark:text-white text-gray-900'
                : 'bg-yellow-600 hover:brightness-[1.1] dark:text-white text-gray-900 disabled:opacity-40'
            }`}
          >
            {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {/* Share & leaderboard */}
        <div className="space-y-3 animate-step opacity-0" style={{ animationDelay: '120ms', animationFillMode: 'forwards' }}>
          <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase">Sharing</p>

          <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[14px] dark:text-white/80 text-gray-800 font-medium">Public profile</p>
                <p className="text-[12px] text-gray-600 mt-0.5">Anyone with the link can see your stats</p>
              </div>
              <button
                onClick={togglePublic}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${isPublic ? 'bg-yellow-600' : 'bg-white/[0.1]'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${isPublic ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            {isPublic && (
              <div className="flex items-center gap-2 dark:bg-white/[0.04] bg-[#FAF9F6] rounded-xl px-3 py-2">
                <span className="flex-1 text-[12px] text-gray-600 truncate">
                  {typeof window !== 'undefined' ? `${window.location.origin}/u/${userId}` : `/u/${userId}`}
                </span>
                <button
                  onClick={copyShareLink}
                  className="shrink-0 text-[12px] font-medium dark:text-yellow-400 text-yellow-700 hover:dark:text-yellow-300 text-yellow-700 transition-colors"
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          <a
            href="/stats"
            className="flex items-center justify-between w-full dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl px-4 py-3 hover:dark:bg-white/[0.05] bg-[#F6F5F2] transition-colors duration-150 active:scale-[0.97]"
          >
            <span className="text-[14px] dark:text-white/80 text-gray-800">View your stats</span>
            <span className="text-gray-600 text-[18px] leading-none">›</span>
          </a>
        </div>

        {/* Lecturer consents */}
        <div className="space-y-3 animate-step opacity-0" style={{ animationDelay: '150ms', animationFillMode: 'forwards' }}>
          <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase">Lecturer consents</p>
          <p className="text-[12px] text-gray-500 dark:text-white/60">Modules where your lecturer is happy for Demist to save full notes.</p>
          <ConsentManager />
        </div>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="w-full py-4 rounded-2xl text-[15px] font-medium dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] text-gray-700 hover:text-red-400 hover:border-red-500/20 transition-all animate-step opacity-0"
          style={{ animationDelay: '180ms', animationFillMode: 'forwards' }}
        >
          Sign out
        </button>

        {/* Danger zone */}
        <div className="pt-8 mt-2 border-t dark:border-white/[0.05] border-black/[0.07] animate-step opacity-0" style={{ animationDelay: '220ms', animationFillMode: 'forwards' }}>
          <button
            onClick={() => { setShowDeleteModal(true); setDeleteConfirmText(''); setDeleteError(null) }}
            className="text-[13px] text-red-400/70 hover:text-red-400 transition-colors"
          >
            Delete account
          </button>
        </div>
      </div>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-4 dark:bg-black/60 bg-black/30"
          style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm dark:bg-[#0d0d1c] bg-[#FDFCF9] border dark:border-red-500/20 border-red-300/60 rounded-[24px] p-6">
            <p className="text-[17px] font-bold dark:text-white text-gray-900 mb-2">Delete your account?</p>
            <p className="text-[13px] dark:text-white/60 text-gray-600 leading-relaxed mb-4">
              This will permanently delete your account, all recordings, terms, and flashcards. This cannot be undone.
            </p>
            <label className="text-[12px] text-gray-600 mb-1.5 block">Type DELETE to confirm</label>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              className="w-full dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.10] border-black/[0.13] rounded-2xl px-4 py-3 dark:text-white text-gray-900 text-[14px] placeholder-gray-700 focus:outline-none focus:border-red-500/50 transition-colors mb-3"
            />
            {deleteError && <p className="text-[12px] text-red-400 mb-3">{deleteError}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-3 rounded-2xl text-[14px] font-medium dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] dark:text-gray-300 text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== 'DELETE' || deleting}
                className="flex-1 py-3 rounded-2xl text-[14px] font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-40 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      )}
      {paywall && <PaywallModal source={paywall} onClose={() => setPaywall(null)} />}
    </main>
  )
}
