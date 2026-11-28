// Pro bought in the app, through Apple in-app purchase via RevenueCat
// (decided 2026-11-28: same price as the web, RevenueCat handles renewals,
// refunds and restores). The purchase itself is Apple's; what unlocks Pro
// everywhere is the subscriptions row the revenuecat-webhook edge function
// writes, so the web and Windows app see it too.
//
// The RevenueCat user is the Supabase user id, so a purchase belongs to the
// Demist account, not to the phone.
import { Platform } from 'react-native'
import Purchases, { PACKAGE_TYPE, type CustomerInfo, type PurchasesPackage } from 'react-native-purchases'

const KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
export const ENTITLEMENT_ID = 'pro'

let current: string | null = null

/** False in builds without a RevenueCat key: the Pro screen then says it is not available. */
export function purchasesAvailable(): boolean {
  return Platform.OS === 'ios' && !!KEY
}

export async function startPurchases(userId: string): Promise<boolean> {
  if (!purchasesAvailable()) return false
  if (current === userId) return true
  if (current === null) Purchases.configure({ apiKey: KEY!, appUserID: userId })
  else await Purchases.logIn(userId)
  current = userId
  return true
}

export async function stopPurchases(): Promise<void> {
  if (!current || current === '__signed_out__') return
  try { await Purchases.logOut() } catch { /* already anonymous */ }
  current = '__signed_out__'
}

export interface ProPackages { monthly: PurchasesPackage | null; yearly: PurchasesPackage | null }

export async function loadPackages(): Promise<ProPackages> {
  const offerings = await Purchases.getOfferings()
  const list = offerings.current?.availablePackages ?? []
  return {
    monthly: list.find(p => p.packageType === PACKAGE_TYPE.MONTHLY) ?? null,
    yearly: list.find(p => p.packageType === PACKAGE_TYPE.ANNUAL) ?? null,
  }
}

/** When the entitlement ends, if active, so the app can show Pro before the webhook lands. */
export function proUntil(info: CustomerInfo): string | null {
  const e = info.entitlements.active[ENTITLEMENT_ID]
  return e ? (e.expirationDate ?? '2999-01-01T00:00:00Z') : null
}

export type BuyResult = { ok: true; until: string | null } | { ok: false; cancelled: boolean; message: string }

export async function buy(pkg: PurchasesPackage): Promise<BuyResult> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg)
    return { ok: true, until: proUntil(customerInfo) }
  } catch (e: unknown) {
    const err = e as { userCancelled?: boolean; message?: string }
    return { ok: false, cancelled: !!err.userCancelled, message: err.message ?? 'The purchase did not go through.' }
  }
}

export async function restore(): Promise<string | null> {
  return proUntil(await Purchases.restorePurchases())
}
