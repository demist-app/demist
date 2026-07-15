'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'

interface Consent {
  id: string
  module_name: string
  granted_at: string
  notes: string | null
}

// ── useMicModeAcknowledged ─────────────────────────────────────────────────────

export function useMicModeAcknowledged(subject: string) {
  const [acknowledged, setAcknowledged] = useState(false)
  useEffect(() => {
    createClient()
      .from('mic_acknowledgments')
      .select('user_id')
      .eq('subject', subject)
      .maybeSingle()
      .then(({ data }) => setAcknowledged(!!data))
  }, [subject])
  return acknowledged
}

// ── ConsentModal ───────────────────────────────────────────────────────────────

function emailTemplate(module: string) {
  return `Subject: Permission to use AI study aid during ${module} lectures

Dear [Lecturer name],

I use a tool called Demist to help me understand technical terms during your lectures. It listens via my microphone, identifies subject-specific terms in real time, and generates flash cards; it doesn't share recordings with anyone or store them permanently.

I'd like to ask for your permission to use it during ${module} sessions. The app requires explicit written consent before saving any transcript or summary.

If you're happy to grant permission, a simple reply to this email is enough.

Thank you for your time.
[Your name]`
}

export function ConsentModal({
  subject,
  onClose,
  onGranted,
}: {
  subject: string | null | undefined
  onClose: () => void
  onGranted?: () => void
}) {
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const module = subject || 'my module'
  const template = emailTemplate(module)

  const copyTemplate = async () => {
    try { await navigator.clipboard.writeText(template) } catch { /* ignore */ }
    setCopied(true)
    capture('consent_template_copied', { subject: module })
    setTimeout(() => setCopied(false), 2000)
  }

  const saveConsent = async () => {
    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      await supabase.from('lecturer_consents').upsert({
        user_id: session.user.id,
        module_name: module,
        notes: notes.trim() || null,
        granted_at: new Date().toISOString(),
      }, { onConflict: 'user_id,module_name' })
      capture('consent_granted', { subject: module })
      onGranted?.()
      onClose()
    } catch (e) {
      console.error('saveConsent error:', e)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 dark:bg-black/60 bg-black/30"
      style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md dark:bg-[#0d0d1c] bg-[#FDFCF9] border dark:border-white/[0.08] border-black/[0.12] rounded-[24px] p-6 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[17px] font-bold dark:text-white text-gray-900 leading-snug">Lecturer consent</p>
          <button onClick={onClose} className="text-gray-500 hover:dark:text-white/60 hover:text-gray-900 text-[22px] leading-none transition-colors shrink-0 mt-[-2px]">×</button>
        </div>

        <p className="text-[13px] dark:text-white/60 text-gray-600 leading-relaxed">
          Under UK copyright and performers&apos; rights law, your lecturer owns the rights to their live performance.
          Once you&apos;ve received written consent, record it here and Demist will save transcripts for{' '}
          <strong className="dark:text-white/80 text-gray-800">{module}</strong> sessions.
        </p>

        <div className="dark:bg-white/[0.03] bg-[#F6F5F2] border dark:border-white/[0.06] border-black/[0.10] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b dark:border-white/[0.06] border-black/[0.08]">
            <p className="text-[11px] font-bold tracking-[0.14em] dark:text-yellow-400 text-yellow-700 uppercase">Email template</p>
            <button
              onClick={copyTemplate}
              className="text-[12px] font-medium dark:text-yellow-400 text-yellow-700 hover:dark:text-yellow-300 hover:text-yellow-900 transition-colors active:scale-[0.97]"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <pre className="px-4 py-3 text-[11px] dark:text-white/50 text-gray-600 leading-relaxed whitespace-pre-wrap font-mono select-text overflow-x-auto">{template}</pre>
        </div>

        <div>
          <label className="text-[12px] text-gray-600 mb-1.5 block">
            Notes <span className="text-gray-500">(optional, e.g. &ldquo;Email reply received 30 Jun&rdquo;)</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Record how consent was given…"
            rows={2}
            maxLength={300}
            className="w-full dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.10] border-black/[0.13] rounded-2xl px-4 py-3 dark:text-white text-gray-900 text-[13px] placeholder-gray-600 focus:outline-none focus:border-yellow-500/50 transition-colors resize-none"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl text-[14px] font-medium dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] dark:text-gray-300 text-gray-700 transition-colors active:scale-[0.97]"
          >
            Cancel
          </button>
          <button
            onClick={saveConsent}
            disabled={saving}
            className="flex-1 py-3 rounded-2xl text-[14px] font-semibold bg-yellow-600 hover:brightness-[1.1] dark:text-white text-gray-900 disabled:opacity-40 transition-colors active:scale-[0.97]"
          >
            {saving ? 'Saving…' : 'I have consent'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── ConsentManager ─────────────────────────────────────────────────────────────

export function ConsentManager() {
  const [consents, setConsents] = useState<Consent[]>([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState<string | null>(null)
  const [addingSubject, setAddingSubject] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)

  const fetchConsents = () => {
    const supabase = createClient()
    supabase
      .from('lecturer_consents')
      .select('id, module_name, granted_at, notes')
      .order('granted_at', { ascending: false })
      .then(({ data }) => {
        setConsents((data as Consent[]) ?? [])
        setLoading(false)
      })
  }

  useEffect(() => { fetchConsents() }, [])

  const removeConsent = async (id: string, moduleName: string) => {
    setRemoving(id)
    try {
      const supabase = createClient()
      await supabase.from('lecturer_consents').delete().eq('id', id)
      capture('consent_removed', { subject: moduleName })
      setConsents(prev => prev.filter(c => c.id !== id))
    } catch (e) {
      console.error('removeConsent error:', e)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={addingSubject}
          onChange={e => setAddingSubject(e.target.value)}
          placeholder="Module or subject name"
          maxLength={100}
          className="flex-1 dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.10] border-black/[0.13] rounded-xl px-3 py-2 text-[13px] dark:text-white text-gray-900 placeholder-gray-500 focus:outline-none focus:border-yellow-500/50 transition-colors"
        />
        <button
          onClick={() => { if (addingSubject.trim()) { capture('consent_modal_opened', { subject: addingSubject.trim() }); setShowAddModal(true) } }}
          disabled={!addingSubject.trim()}
          className="shrink-0 text-[13px] font-semibold text-yellow-600 dark:text-yellow-400 hover:opacity-80 disabled:opacity-40 transition-opacity px-3"
        >
          Add
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map(i => (
            <div key={i} className="h-14 dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : !consents.length ? (
        <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl px-4 py-4">
          <p className="text-[13px] text-gray-600">No lecturer consents recorded yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {consents.map(c => (
            <div
              key={c.id}
              className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl px-4 py-3 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium dark:text-white/80 text-gray-800 truncate">{c.module_name}</p>
                <p className="text-[11px] text-gray-600 mt-0.5 truncate">
                  {new Date(c.granted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {c.notes ? ` · ${c.notes}` : ''}
                </p>
              </div>
              <button
                onClick={() => removeConsent(c.id, c.module_name)}
                disabled={removing === c.id}
                className="shrink-0 text-[12px] text-red-400/60 hover:text-red-400 transition-colors disabled:opacity-40 active:scale-[0.97]"
              >
                {removing === c.id ? '…' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <ConsentModal
          subject={addingSubject}
          onClose={() => setShowAddModal(false)}
          onGranted={() => { setShowAddModal(false); setAddingSubject(''); fetchConsents() }}
        />
      )}
    </div>
  )
}
