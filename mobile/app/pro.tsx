// Demist Pro, bought through Apple (lib/purchases.ts). Calm and plain: what
// Pro adds, two prices from the App Store, restore, and the subscription terms
// Apple requires (Guideline 3.1.2) with links to the privacy policy and terms.
import { useEffect, useState } from 'react'
import { Alert, Linking, Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { useAccount } from '../lib/account'
import { capture } from '../lib/analytics'
import { buy, loadPackages, purchasesAvailable, restore, startPurchases, type ProPackages } from '../lib/purchases'
import { Button, Card, Screen, T, Title } from '../components/ui'
import type { PurchasesPackage } from 'react-native-purchases'

const BENEFITS = [
  'Full notes for every lecture. The free plan writes notes for 3 lectures a month.',
  'Every lecture kept for the whole year, not just the last 7 days.',
  'Pro works everywhere you sign in: this app, the website and the Windows app.',
]

export default function ProScreen() {
  const { session, entitlement, showStorePro } = useAccount()
  const [packages, setPackages] = useState<ProPackages | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const available = purchasesAvailable()
  const paid = entitlement.plan === 'pro' && entitlement.source === 'paid'

  useEffect(() => {
    capture('pro_screen_viewed', { plan: entitlement.plan, source: entitlement.source })
    const uid = session?.user.id
    if (!available || !uid || paid) return
    startPurchases(uid)
      .then(loadPackages)
      .then(setPackages)
      .catch(() => setLoadError(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, available, paid])

  const purchase = async (pkg: PurchasesPackage, which: 'monthly' | 'yearly') => {
    setBusy(which)
    capture('pro_purchase_started', { which })
    const r = await buy(pkg)
    setBusy(null)
    if (r.ok) {
      capture('pro_purchase_completed', { which })
      if (r.until) showStorePro(r.until)
      Alert.alert('Thank you', 'Pro is on your account.', [{ text: 'OK', onPress: () => router.back() }])
    } else if (!r.cancelled) {
      capture('pro_purchase_failed', { which })
      Alert.alert('Purchase not completed', r.message)
    }
  }

  const onRestore = async () => {
    const uid = session?.user.id
    if (!uid) return
    setBusy('restore')
    try {
      await startPurchases(uid)
      const until = await restore()
      capture('pro_restore', { found: !!until })
      if (until) { showStorePro(until); Alert.alert('Restored', 'Pro is on your account.') }
      else Alert.alert('Nothing to restore', 'There is no Demist Pro subscription on this Apple ID.')
    } catch {
      Alert.alert('Could not restore', 'Check your connection and try again.')
    }
    setBusy(null)
  }

  const until = entitlement.periodEnd ? new Date(entitlement.periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null

  return (
    <Screen edges={['top', 'bottom']}>
      <Title sub="Made by Graceful Minds, a charity for neurodivergent young people.">Demist Pro</Title>
      <Card style={{ gap: 10 }}>
        {BENEFITS.map(b => <T key={b} size={15}>{'•'} {b}</T>)}
        <T size={13} tone="muted">Everything live stays free: explanations, your glossary and flashcards.</T>
      </Card>

      {paid ? (
        <Card style={{ marginTop: 16, gap: 8 }}>
          <T weight={600}>You have Pro{until ? ` until ${until}` : ''}.</T>
          <Button kind="secondary" label="Manage subscription" onPress={() => Linking.openURL('https://apps.apple.com/account/subscriptions')} />
        </Card>
      ) : !available ? (
        <Card style={{ marginTop: 16 }}><T tone="muted">Pro is not available in this version of the app yet.</T></Card>
      ) : (
        <View style={{ marginTop: 16, gap: 10 }}>
          {entitlement.plan === 'pro' && until ? (
            <T size={14} tone="muted">You have Pro free until {until}. Subscribe to keep it after that.</T>
          ) : null}
          {loadError ? <T tone="muted">Prices could not load. Check your connection and open this screen again.</T> : null}
          {!packages && !loadError ? <T tone="muted">Loading prices...</T> : null}
          {packages?.yearly ? (
            <Button label={`${packages.yearly.product.priceString} a year`} loading={busy === 'yearly'} disabled={!!busy}
              onPress={() => purchase(packages.yearly!, 'yearly')} style={{ minHeight: 52 }} />
          ) : null}
          {packages?.monthly ? (
            <Button kind="secondary" label={`${packages.monthly.product.priceString} a month`} loading={busy === 'monthly'} disabled={!!busy}
              onPress={() => purchase(packages.monthly!, 'monthly')} style={{ minHeight: 52 }} />
          ) : null}
          <Button kind="quiet" label="Restore purchases" loading={busy === 'restore'} disabled={!!busy} onPress={onRestore} />
          <T size={12} tone="faint">
            Payment is charged to your Apple ID when you confirm. The subscription renews automatically at the same price unless you cancel it at least 24 hours before the end of the current period. You can manage or cancel it at any time in your Apple ID settings.
          </T>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 16, marginTop: 14, justifyContent: 'center' }}>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://demist.app/terms')}><T size={13} tone="muted">Terms of Use</T></Pressable>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://demist.app/privacy')}><T size={13} tone="muted">Privacy Policy</T></Pressable>
      </View>
      <Button kind="quiet" label="Not now" onPress={() => router.back()} style={{ marginTop: 8 }} />
    </Screen>
  )
}
