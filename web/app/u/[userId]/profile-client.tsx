'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

interface PublicProfile {
  display_name: string | null
  course: string | null
  year_of_study: number | null
  total_terms: number
  terms_this_week: number
}

export default function PublicProfileClient() {
  const { userId } = useParams<{ userId: string }>()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!userId) return
    const supabase = createClient()
    ;(async () => {
      const { data, error } = await supabase.rpc('get_public_profile_stats', { target_user_id: userId })
      if (error || !data?.length) { setNotFound(true); setLoading(false); return }
      setProfile(data[0] as PublicProfile)
      setLoading(false)
    })()
  }, [userId])

  if (loading) return <div className="min-h-dvh bg-[#080810]" />

  if (notFound) {
    return (
      <main className="min-h-dvh bg-[#080810] text-white flex flex-col items-center justify-center px-6 text-center gap-4">
        <p className="text-[44px]">🔒</p>
        <h1 className="text-[22px] font-bold">Profile not found</h1>
        <p className="text-gray-500 text-[15px]">This profile is private or doesn't exist.</p>
        <Link href="/" className="mt-4 text-[14px] text-violet-400 hover:text-violet-300 transition-colors">
          ← Back to Demist
        </Link>
      </main>
    )
  }

  const name = profile?.display_name || 'A Demist user'
  const initials = name.slice(0, 1).toUpperCase()
  const shareImageUrl = `/api/og/${userId}`

  return (
    <main className="min-h-dvh bg-[#080810] text-white flex flex-col items-center justify-center px-6 py-12">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[700px] h-[700px] rounded-full bg-violet-600/[0.07] blur-[140px]" />
      </div>

      <div className="relative w-full max-w-[420px] space-y-6">
        {/* Brand */}
        <p className="text-[11px] font-bold tracking-[0.22em] text-violet-400/70 uppercase">Demist</p>

        {/* Avatar + name */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-[26px] font-bold text-violet-400 shrink-0">
            {initials}
          </div>
          <div>
            <p className="text-[20px] font-bold">{name}</p>
            {profile?.course && (
              <p className="text-[14px] text-gray-500 mt-0.5">{profile.course}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/[0.04] border border-white/[0.07] rounded-2xl px-4 py-4">
            <p className="text-[10px] text-gray-600 uppercase tracking-[0.12em]">This week</p>
            <p className="text-[32px] font-bold leading-none mt-1 text-violet-400">{profile?.terms_this_week}</p>
            <p className="text-[12px] text-gray-600 mt-1">terms learned</p>
          </div>
          <div className="bg-white/[0.04] border border-white/[0.07] rounded-2xl px-4 py-4">
            <p className="text-[10px] text-gray-600 uppercase tracking-[0.12em]">All time</p>
            <p className="text-[32px] font-bold leading-none mt-1">{profile?.total_terms}</p>
            <p className="text-[12px] text-gray-600 mt-1">terms learned</p>
          </div>
        </div>

        {/* Share card download */}
        <a
          href={shareImageUrl}
          download={`${name.replace(/\s+/g, '-').toLowerCase()}-demist.png`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl text-[15px] font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-all"
        >
          Download share card
        </a>

        {/* CTA */}
        <Link
          href="/"
          className="block text-center text-[13px] text-gray-600 hover:text-gray-400 transition-colors"
        >
          Try Demist for free →
        </Link>
      </div>
    </main>
  )
}
