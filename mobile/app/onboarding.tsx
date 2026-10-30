// Same questions, order and rules as web/app/onboarding/page.tsx, including
// the 16+ check (web/lib/age.ts, shared copy). Accounts created before the age
// check existed skip straight to the birthday question.
import { useMemo, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, View, type TextInput } from 'react-native'
import { supabase } from '../lib/supabase'
import { useAccount } from '../lib/account'
import { usePrefs } from '../lib/prefs'
import { capture, reportWriteFailure } from '../lib/analytics'
import { MINIMUM_AGE, meetsMinimumAge } from '../lib/shared/age'
import { Button, Chip, Screen, T, Input } from '../components/ui'
import { radius } from '../lib/theme'

const YEARS = [
  { value: 1, label: '1st year' }, { value: 2, label: '2nd year' }, { value: 3, label: '3rd year' },
  { value: 4, label: '4th year' }, { value: 5, label: '5th year' }, { value: 6, label: '6th year' },
  { value: 7, label: 'Masters' }, { value: 8, label: 'PhD' },
]
const SUPPORT_NEEDS = [
  { value: 'hearing', label: 'Hearing' },
  { value: 'dyslexia', label: 'Reading or dyslexia' },
  { value: 'attention', label: 'Focus or attention' },
  { value: 'language', label: 'English isn’t my first language' },
  { value: 'none', label: 'None of these' },
  { value: 'other', label: 'Prefer not to say' },
]
const HEARD_FROM = [
  { value: 'app_store', label: 'The App Store' },
  { value: 'friend', label: 'A friend or coursemate' },
  { value: 'lecturer', label: 'A lecturer or my university' },
  { value: 'google', label: 'Google' },
  { value: 'ai_assistant', label: 'ChatGPT, Gemini or a similar assistant' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'other', label: 'Somewhere else' },
]

type Step = 'course' | 'year' | 'need' | 'birthday' | 'heard'

export default function Onboarding() {
  const { session, profile, refreshProfile, signOut } = useAccount()
  const { c, font, size } = usePrefs()
  const onlyBirthday = !!profile?.year_of_study
  const [step, setStep] = useState<Step>(onlyBirthday ? 'birthday' : 'course')
  const [course, setCourse] = useState(profile?.course ?? '')
  const [year, setYear] = useState<number | null>(profile?.year_of_study ?? null)
  const [need, setNeed] = useState<string | null>(profile?.support_need ?? null)
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [yr, setYr] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tooYoung, setTooYoung] = useState(false)
  const monthRef = useRef<TextInput>(null)
  const yearRef = useRef<TextInput>(null)

  const dob = useMemo(() => {
    const d = Number(day), m = Number(month), y = Number(yr)
    if (!d || !m || yr.length !== 4) return null
    const date = new Date(Date.UTC(y, m - 1, d))
    if (date.getUTCDate() !== d || date.getUTCMonth() !== m - 1) return null
    return `${yr}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }, [day, month, yr])

  const input = {
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg,
    paddingHorizontal: 16, paddingVertical: 16, color: c.fg, fontSize: size(17), fontFamily: font(500),
  }

  const saveProfile = async () => {
    const uid = session?.user.id
    if (!uid || !dob || saving) return
    const ok = meetsMinimumAge(dob)
    if (ok === null) { setError('Please check that date.'); return }
    if (!ok) { setTooYoung(true); capture('onboarding_underage', { platform: 'ios' }); return }
    setSaving(true); setError(null)
    const { error } = await supabase.from('profiles').upsert({
      id: uid,
      course: course.trim() || null,
      year_of_study: year,
      support_need: need,
      date_of_birth: dob,
      ai_disclaimer_ack_at: new Date().toISOString(),
    })
    setSaving(false)
    if (reportWriteFailure('profile.onboarding', error)) { setError('Could not save. Check your connection and try again.'); return }
    capture('onboarding_completed', { platform: 'ios', year_of_study: year, support_need: need, birthday_only: onlyBirthday })
    if (onlyBirthday) await refreshProfile()
    else setStep('heard')
  }

  const finishHeard = async (value: string) => {
    const uid = session?.user.id
    capture('heard_about_us', { source: value, platform: 'ios' })
    if (uid) {
      const { error } = await supabase.from('profiles').update({ heard_from: value }).eq('id', uid)
      reportWriteFailure('profile.heard_from', error, { source: value })
    }
    await refreshProfile()
  }

  if (tooYoung) {
    return (
      <Screen scroll={false} edges={['top', 'bottom']} style={{ justifyContent: 'center' }}>
        <T size={28} weight={700} style={{ marginBottom: 10 }}>Demist is for people aged {MINIMUM_AGE} and over</T>
        <T tone="muted" style={{ marginBottom: 28 }}>
          Recording a lecture records your lecturer too, and that needs permission we can only ask someone {MINIMUM_AGE} or over to get. Thank you for understanding.
        </T>
        <Button label="Sign out" kind="secondary" onPress={signOut} />
      </Screen>
    )
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']} style={{ paddingTop: 48, maxWidth: 480 }}>
        {step === 'course' && (
          <>
            <T size={30} weight={700} style={{ marginBottom: 8 }}>What are you studying?</T>
            <T tone="muted" style={{ marginBottom: 24 }}>We use this to get explanations at the right level.</T>
            <Input style={input} value={course} onChangeText={setCourse} placeholder="e.g. Molecular Biology"
              placeholderTextColor={c.fgFaint} returnKeyType="next" onSubmitEditing={() => setStep('year')} accessibilityLabel="Your course" />
            <Button style={{ marginTop: 16 }} label={course.trim() ? 'Continue' : 'Skip for now'} onPress={() => setStep('year')} />
          </>
        )}

        {step === 'year' && (
          <>
            <T size={30} weight={700} style={{ marginBottom: 8 }}>What year are you in?</T>
            <T tone="muted" style={{ marginBottom: 24 }}>So we get the depth just right.</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }} accessibilityRole="radiogroup">
              {YEARS.map(y => <Chip key={y.value} label={y.label} selected={year === y.value} onPress={() => setYear(y.value)} />)}
            </View>
            <Button style={{ marginTop: 28 }} label="Continue" disabled={!year} onPress={() => setStep('need')} />
          </>
        )}

        {step === 'need' && (
          <>
            <T size={30} weight={700} style={{ marginBottom: 8 }}>Does anything make lectures harder to follow?</T>
            <T tone="muted" style={{ marginBottom: 24 }}>This tailors Demist to you. You can change it anytime in Settings.</T>
            <View style={{ gap: 10 }} accessibilityRole="radiogroup">
              {SUPPORT_NEEDS.map(n => <Chip key={n.value} label={n.label} selected={need === n.value} onPress={() => setNeed(n.value)} />)}
            </View>
            <Button style={{ marginTop: 28 }} label="Continue" disabled={!need} onPress={() => setStep('birthday')} />
          </>
        )}

        {step === 'birthday' && (
          <>
            <T size={30} weight={700} style={{ marginBottom: 8 }}>When’s your birthday?</T>
            <T tone="muted" style={{ marginBottom: 4 }}>Demist is for people aged {MINIMUM_AGE} and over, so we need to check. We never share this.</T>
            <T size={13} tone="faint" style={{ marginBottom: 20 }}>Recording a lecture captures your lecturer too, and our Terms make that your responsibility.</T>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Input style={[input, { flex: 1, textAlign: 'center' }]} value={day} placeholder="DD" placeholderTextColor={c.fgFaint}
                keyboardType="number-pad" maxLength={2} accessibilityLabel="Day of birth"
                onChangeText={t => { const v = t.replace(/\D/g, ''); setDay(v); if (v.length === 2) monthRef.current?.focus() }} />
              <Input ref={monthRef} style={[input, { flex: 1, textAlign: 'center' }]} value={month} placeholder="MM" placeholderTextColor={c.fgFaint}
                keyboardType="number-pad" maxLength={2} accessibilityLabel="Month of birth"
                onChangeText={t => { const v = t.replace(/\D/g, ''); setMonth(v); if (v.length === 2) yearRef.current?.focus() }} />
              <Input ref={yearRef} style={[input, { flex: 1.6, textAlign: 'center' }]} value={yr} placeholder="YYYY" placeholderTextColor={c.fgFaint}
                keyboardType="number-pad" maxLength={4} accessibilityLabel="Year of birth"
                onChangeText={t => setYr(t.replace(/\D/g, ''))} />
            </View>
            <T size={12} tone="faint" style={{ marginTop: 16 }}>
              Demist’s explanations are written automatically and are occasionally imperfect. Always check anything important against your course materials.
            </T>
            <Button style={{ marginTop: 24 }} label="Continue" disabled={!dob} loading={saving} onPress={saveProfile} />
          </>
        )}

        {step === 'heard' && (
          <>
            <T size={30} weight={700} style={{ marginBottom: 8 }}>One last thing. How did you find us?</T>
            <T tone="muted" style={{ marginBottom: 24 }}>One tap. It tells us where to put our effort.</T>
            <View style={{ gap: 10 }}>
              {HEARD_FROM.map(h => <Chip key={h.value} label={h.label} selected={false} onPress={() => finishHeard(h.value)} />)}
            </View>
            <Button style={{ marginTop: 20 }} kind="quiet" label="Skip" onPress={refreshProfile} />
          </>
        )}

        {!!error && <T size={14} tone="danger" style={{ marginTop: 14 }}>{error}</T>}
      </Screen>
    </KeyboardAvoidingView>
  )
}
