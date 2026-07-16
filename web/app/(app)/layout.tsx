'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'
import { InstallPrompt } from '@/components/InstallPrompt'
import { NativeTranslateProvider, useNativeTranslate } from '@/lib/useNativeTranslate'
import { applyStoredFontScale } from '@/lib/fontScale'

function TranslateWarmup() {
  const nativeTranslate = useNativeTranslate()
  useEffect(() => {
    createClient().auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: prof } = await createClient().from('profiles').select('translate_to').eq('id', data.user.id).maybeSingle()
      const translateTo = (prof as { translate_to: string | null } | null)?.translate_to
      if (translateTo) nativeTranslate.start(translateTo, { onlyIfReady: true })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    applyStoredFontScale()
    createClient().auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/login'); return }
      setReady(true)
    })
  }, [])

  if (!ready) return (
    <NativeTranslateProvider>
      <TranslateWarmup />
      <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg)' }}>
        <div className="hidden sm:flex h-14 items-center px-8 gap-8 animate-pulse" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="h-3.5 w-14 rounded-full" style={{ background: 'var(--surface-2)' }} />
          {[60,52,56,52,48].map((w,i) => (
            <div key={i} className="h-2.5 rounded-full" style={{ width: w, background: 'var(--surface)' }} />
          ))}
        </div>
        <div className="flex-1 px-4 sm:px-8 py-6 animate-pulse max-w-4xl mx-auto w-full">
          <div className="h-6 w-40 rounded-full mb-8" style={{ background: 'var(--surface-2)' }} />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            {[0,1,2].map(i => (
              <div key={i} className="h-20 rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
            ))}
          </div>
          {[0,1,2,3].map(i => (
            <div key={i} className="h-14 rounded-2xl mb-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
          ))}
        </div>
        <div className="sm:hidden h-[52px] flex items-center justify-around px-2 animate-pulse" style={{ borderTop: '1px solid var(--border)', background: 'var(--mobile-nav-bg)' }}>
          {[0,1,2,3,4].map(i => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div className="w-5 h-5 rounded-md" style={{ background: 'var(--surface-2)' }} />
              <div className="w-8 h-1.5 rounded-full" style={{ background: 'var(--surface)' }} />
            </div>
          ))}
        </div>
      </div>
    </NativeTranslateProvider>
  )

  return (
    <NativeTranslateProvider>
      <TranslateWarmup />
      <AppNav />
      <InstallPrompt />

      {/* Content */}
      <div className="sm:pt-14">
        {children}
      </div>
    </NativeTranslateProvider>
  )
}
