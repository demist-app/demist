'use client'

import { createClient } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import posthog from 'posthog-js'

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const router = useRouter()

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
      else {
        setUser(data.user)
        posthog.identify(data.user.id)
        posthog.capture('dashboard_viewed')
      }
    })
  }, [])

  return (
    <main className="min-h-screen bg-black text-white p-8">
      <h1 className="text-3xl font-bold mb-2">Your Glossary</h1>
      <p className="text-gray-400">Terms you have encountered will appear here.</p>
    </main>
  )
}
