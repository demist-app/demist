// Who is signed in, their profile, and whether they have Pro, through the same
// rule the web uses. Pro can be bought in the app through Apple (app/pro.tsx,
// lib/purchases.ts); one bought on the web or Windows shows up here too.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { identify, resetAnalytics } from './analytics'
import { startPurchases, stopPurchases } from './purchases'
import { resolveEntitlement, LIMITS, type Entitlement, type SubscriptionRow } from './shared/entitlementRules'

export interface Profile {
  id: string
  course: string | null
  year_of_study: number | null
  support_need: string | null
  date_of_birth: string | null
  display_name: string | null
}

interface Ctx {
  /** undefined while the stored session is still being read. */
  session: Session | null | undefined
  profile: Profile | null
  profileLoaded: boolean
  entitlement: Entitlement
  limits: (typeof LIMITS)['free']
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
  /** Show Pro straight after an App Store purchase, before the webhook has written it. */
  showStorePro: (until: string) => void
}

const FREE: Entitlement = { plan: 'free', source: 'free', periodEnd: null, daysLeft: null, lapsedAt: null }
const AccountContext = createContext<Ctx | null>(null)

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [entitlement, setEntitlement] = useState<Entitlement>(FREE)
  // End date of a Pro just bought in the App Store, until the webhook writes it.
  const pendingStoreRef = useRef<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  const refreshProfile = useCallback(async () => {
    if (!userId) { setProfile(null); setProfileLoaded(true); return }
    const [{ data: prof }, { data: sub }] = await Promise.all([
      supabase.from('profiles').select('id, course, year_of_study, support_need, date_of_birth, display_name').eq('id', userId).maybeSingle(),
      // Every column, so store_transaction_id (migration 046) is read when present.
      supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle(),
    ])
    setProfile((prof as Profile | null) ?? null)
    const fromDb = resolveEntitlement(sub as SubscriptionRow | null, session?.user.created_at ?? null)
    // Keep a just-bought Pro showing until the database agrees.
    setEntitlement(prev => (pendingStoreRef.current && fromDb.plan !== 'pro' && new Date(pendingStoreRef.current) > new Date()) ? prev : fromDb)
    setProfileLoaded(true)
  }, [userId, session?.user.created_at])

  useEffect(() => {
    setProfileLoaded(false)
    void refreshProfile()
    if (userId) {
      void identify(userId)
      // Tie App Store purchases to the Demist account, never the phone.
      startPurchases(userId).catch(() => {})
    }
  }, [userId, refreshProfile])

  const showStorePro = useCallback((until: string) => {
    pendingStoreRef.current = until
    setEntitlement({ plan: 'pro', source: 'paid', periodEnd: until, daysLeft: null, lapsedAt: null })
    // The webhook usually lands within seconds; check a few times.
    for (const ms of [3000, 10000, 30000]) setTimeout(() => { void refreshProfile() }, ms)
  }, [refreshProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    await stopPurchases()
    pendingStoreRef.current = null
    resetAnalytics()
    setProfile(null)
  }, [])

  return (
    <AccountContext.Provider value={{
      session, profile, profileLoaded, entitlement, limits: LIMITS[entitlement.plan], refreshProfile, signOut, showStorePro,
    }}>
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount(): Ctx {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount outside AccountProvider')
  return ctx
}
