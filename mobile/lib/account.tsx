// Who is signed in, their profile, and whether they have Pro. Pro is never
// sold in the iOS app (App Store 3.1.3(b)): a subscription bought on the web
// or Windows simply shows up here, through the same rule the web uses.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { identify, resetAnalytics } from './analytics'
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
}

const FREE: Entitlement = { plan: 'free', source: 'free', periodEnd: null, daysLeft: null, lapsedAt: null }
const AccountContext = createContext<Ctx | null>(null)

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [entitlement, setEntitlement] = useState<Entitlement>(FREE)

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
      supabase.from('subscriptions').select('plan, current_period_end, stripe_customer_id, stripe_subscription_id').eq('user_id', userId).maybeSingle(),
    ])
    setProfile((prof as Profile | null) ?? null)
    setEntitlement(resolveEntitlement(sub as SubscriptionRow | null, session?.user.created_at ?? null))
    setProfileLoaded(true)
  }, [userId, session?.user.created_at])

  useEffect(() => {
    setProfileLoaded(false)
    void refreshProfile()
    if (userId) void identify(userId)
  }, [userId, refreshProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    resetAnalytics()
    setProfile(null)
  }, [])

  return (
    <AccountContext.Provider value={{
      session, profile, profileLoaded, entitlement, limits: LIMITS[entitlement.plan], refreshProfile, signOut,
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
