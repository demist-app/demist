import { useState } from 'react'
import { Alert, Image, Linking, Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { useAccount } from '../../lib/account'
import { usePrefs, FONT_OPTIONS, TINT_OPTIONS, TEXT_SIZES, type Appearance } from '../../lib/prefs'
import { capture, reportWriteFailure, resetAnalytics } from '../../lib/analytics'
import { useRecording } from '../../lib/recording'
import { radius } from '../../lib/theme'
import { Button, Card, Chip, Screen, SectionLabel, T, Title, Input } from '../../components/ui'
import { ChevronIcon } from '../../components/icons'

const SUPPORT_NEEDS = [
  { value: 'hearing', label: 'Hearing' },
  { value: 'dyslexia', label: 'Reading or dyslexia' },
  { value: 'attention', label: 'Focus or attention' },
  { value: 'language', label: 'English isn’t my first language' },
  { value: 'none', label: 'None of these' },
  { value: 'other', label: 'Prefer not to say' },
]
const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'Match phone' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' },
]

function Row({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
  const { c } = usePrefs()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: 10, opacity: pressed ? 0.7 : 1 })}>
      <T style={{ flex: 1 }}>{label}</T>
      {value ? <T tone="faint" numberOfLines={1} style={{ maxWidth: '50%' }}>{value}</T> : null}
      <ChevronIcon color={c.fgFaint} />
    </Pressable>
  )
}

export default function Settings() {
  const { session, profile, entitlement, refreshProfile, signOut } = useAccount()
  const { prefs, setPrefs, c, font, size } = usePrefs()
  const rec = useRecording()
  const [course, setCourse] = useState(profile?.course ?? '')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const updateProfile = async (patch: Record<string, unknown>) => {
    const uid = session?.user.id
    if (!uid) return
    const { error } = await supabase.from('profiles').update(patch).eq('id', uid)
    if (reportWriteFailure('profile.settings', error)) Alert.alert('Could not save', 'Check your connection and try again.')
    else await refreshProfile()
  }

  const deleteAccount = async () => {
    if (confirmText !== 'DELETE' || deleting) return
    setDeleting(true)
    capture('account_deletion_initiated', { platform: 'ios' })
    const { error } = await supabase.rpc('delete_user_data')
    if (error) {
      setDeleting(false)
      Alert.alert('Could not delete your account', 'Please try again, or email hello@demist.app and we will do it for you.')
      return
    }
    await supabase.auth.signOut()
    resetAnalytics()
  }

  const confirmSignOut = () => {
    if (rec.status !== 'idle') {
      Alert.alert('A lecture is recording', 'Stop the recording before signing out.')
      return
    }
    void signOut()
  }

  const input = {
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 12, color: c.fg, fontFamily: font(400), fontSize: size(15),
  }

  return (
    <Screen>
      <Title>Settings</Title>

      <SectionLabel>Reading comfort</SectionLabel>
      <Card style={{ gap: 14 }}>
        <T size={13} weight={600} tone="muted">Font</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {FONT_OPTIONS.map(f => <Chip key={f.value} label={f.label} selected={prefs.font === f.value} onPress={() => setPrefs({ font: f.value })} />)}
        </View>
        <T size={13} weight={600} tone="muted">Text size</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TEXT_SIZES.map(s => <Chip key={s.value} label={s.label} selected={prefs.textSize === s.value} onPress={() => setPrefs({ textSize: s.value })} />)}
        </View>
        <T size={13} weight={600} tone="muted">Line spacing</T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Normal" selected={prefs.spacing === 'normal'} onPress={() => setPrefs({ spacing: 'normal' })} />
          <Chip label="Relaxed" selected={prefs.spacing === 'relaxed'} onPress={() => setPrefs({ spacing: 'relaxed' })} />
        </View>
        <T size={13} weight={600} tone="muted">Background tint</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TINT_OPTIONS.map(t => <Chip key={t.value} label={t.label} selected={prefs.tint === t.value} onPress={() => setPrefs({ tint: t.value })} />)}
        </View>
        {c.dark && prefs.tint !== 'none' ? <T size={12} tone="faint">Tints show in light mode.</T> : null}
        <T size={13} weight={600} tone="muted">Greyscale</T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Off" selected={!prefs.greyscale} onPress={() => setPrefs({ greyscale: false })} />
          <Chip label="On" selected={prefs.greyscale} onPress={() => setPrefs({ greyscale: true })} />
        </View>
        <T size={12} tone="faint">Shows Demist in shades of grey, for when colour is distracting or too much.</T>
        <T size={13} weight={600} tone="muted">Appearance</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {APPEARANCES.map(a => <Chip key={a.value} label={a.label} selected={prefs.appearance === a.value} onPress={() => setPrefs({ appearance: a.value })} />)}
        </View>
        <T size={15} style={{ marginTop: 4 }}>This is how your lecture notes will read.</T>
      </Card>

      <SectionLabel>About you</SectionLabel>
      <Card style={{ gap: 12 }}>
        <T size={13} weight={600} tone="muted">What you study</T>
        <Input style={input} value={course} onChangeText={setCourse} placeholder="e.g. Molecular Biology" placeholderTextColor={c.fgFaint}
          onEndEditing={() => { if ((course.trim() || null) !== (profile?.course ?? null)) void updateProfile({ course: course.trim() || null }) }}
          returnKeyType="done" accessibilityLabel="What you study" />
        <T size={13} weight={600} tone="muted">Anything that makes lectures harder to follow</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {SUPPORT_NEEDS.map(n => <Chip key={n.value} label={n.label} selected={profile?.support_need === n.value} onPress={() => updateProfile({ support_need: n.value })} />)}
        </View>
      </Card>

      <SectionLabel>Recording</SectionLabel>
      <Card style={{ paddingVertical: 4 }}>
        <Row label="Lecturer permission" value="Modules" onPress={() => router.push('/consents')} />
      </Card>
      <T size={13} tone="muted" style={{ marginTop: 8 }}>
        Transcripts and summaries are kept for modules where your lecturer has said yes, or if you have told us about a support need above.
      </T>

      <SectionLabel>Account</SectionLabel>
      <Card style={{ gap: 6 }}>
        <T size={13} tone="muted">Signed in as</T>
        <T weight={600}>{session?.user.email ?? 'Guest'}</T>
        {entitlement.plan === 'pro' ? <T size={13} tone="calm" style={{ marginTop: 4 }}>Pro is active on this account.</T> : null}
      </Card>
      <Card style={{ paddingVertical: 4, marginTop: 10 }}>
        <Row label="Privacy Policy" onPress={() => Linking.openURL('https://demist.app/privacy')} />
        <Row label="Terms" onPress={() => Linking.openURL('https://demist.app/terms')} />
        <Row label="Help and support" onPress={() => Linking.openURL('https://demist.app/support')} />
      </Card>
      <Button kind="secondary" label="Sign out" onPress={confirmSignOut} style={{ marginTop: 16 }} />

      {deleteOpen ? (
        <Card style={{ marginTop: 16, gap: 12, borderColor: c.danger }}>
          <T weight={700}>Delete your account?</T>
          <T tone="muted">This permanently deletes your account, all recordings, words and flashcards, on every device. This cannot be undone.</T>
          <T size={13} tone="muted">Type DELETE to confirm.</T>
          <Input style={input} value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" autoCorrect={false} accessibilityLabel="Type DELETE to confirm" />
          <Button kind="danger" label="Delete my account" onPress={deleteAccount} loading={deleting} disabled={confirmText !== 'DELETE'} />
          <Button kind="quiet" label="Cancel" onPress={() => { setDeleteOpen(false); setConfirmText('') }} />
        </Card>
      ) : (
        <Button kind="quiet" label="Delete account" onPress={() => setDeleteOpen(true)} style={{ marginTop: 8 }} />
      )}

      <Pressable onPress={() => Linking.openURL('https://www.graceful-minds.org')} accessibilityRole="link" accessibilityLabel="Graceful Minds website"
        style={{ alignItems: 'center', marginTop: 40, gap: 6 }}>
        <Image source={c.dark ? require('../../assets/graceful-minds-logo-dark.png') : require('../../assets/graceful-minds-logo.png')}
          style={{ width: 96, height: 96 }} resizeMode="contain" />
        <T size={12} tone="faint">Demist by Graceful Minds</T>
      </Pressable>
    </Screen>
  )
}
