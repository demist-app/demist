'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

export function BackLink() {
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      if (data.session) setAuthed(true)
    })
  }, [])

  return (
    <a href={authed ? '/dashboard' : '/'} className="text-[12px] font-medium" style={{ color: 'var(--fg-faint)' }}>
      &larr; {authed ? 'Back to Demist' : 'Demist'}
    </a>
  )
}

export function CtaLink() {
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      if (data.session) setAuthed(true)
    })
  }, [])

  return (
    <a
      href={authed ? '/dashboard' : '/login'}
      className="inline-block px-7 py-3.5 rounded-2xl text-[14px] font-semibold transition-colors"
      style={{ background: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}
    >
      {authed ? 'Open Demist' : 'Try Demist free'}
    </a>
  )
}
