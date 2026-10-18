import { useEffect, useRef, useState } from 'react'
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, TextInput, View } from 'react-native'
import { supabase } from '../lib/supabase'
import { capture } from '../lib/analytics'
import { usePrefs } from '../lib/prefs'
import { Button, Screen, T } from '../components/ui'
import { radius } from '../lib/theme'

type Step = 'email' | 'code' | 'password'

// App Review cannot receive a sign-in email, so this one address signs in
// with a password instead (set by web/scripts/set-review-password.mjs).
// Everyone else only ever sees the emailed code.
const REVIEW_EMAIL = 'store-demo@demist.app'

export default function Login() {
  const { c, font, size } = usePrefs()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef<TextInput>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const input = {
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg,
    paddingHorizontal: 18, paddingVertical: 16, color: c.fg, fontSize: size(16), fontFamily: font(400), marginBottom: 12,
  }

  const sendCode = async () => {
    const e = email.trim().toLowerCase()
    if (!e) return
    if (e === REVIEW_EMAIL) { setStep('password'); return }
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithOtp({ email: e, options: { shouldCreateUser: true } })
    setLoading(false)
    if (error) {
      setError(error.status === 429 ? 'Please wait a minute before asking for another code.' : 'Could not send a code. Check the address and your connection.')
      return
    }
    setStep('code'); setCooldown(60)
    setTimeout(() => codeRef.current?.focus(), 150)
  }

  const verify = async () => {
    if (code.length < 6) return
    setLoading(true); setError('')
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' })
    setLoading(false)
    if (error) { setError('That code did not work. Check your email and try again.'); capture('otp_verify_failed', { platform: 'ios' }); return }
    capture('signed_in', { platform: 'ios', method: 'otp' })
  }

  const signInWithPassword = async () => {
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: REVIEW_EMAIL, password })
    setLoading(false)
    if (error) setError('That password did not work.')
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen scroll={false} edges={['top', 'bottom']} style={{ justifyContent: 'center', maxWidth: 440 }}>
        <View style={{ marginBottom: 40, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image source={c.dark ? require('../assets/graceful-minds-logo-dark.png') : require('../assets/graceful-minds-logo.png')}
            style={{ width: 44, height: 44 }} resizeMode="contain" accessibilityIgnoresInvertColors accessible={false} />
          <View>
            <T size={18} weight={700}>Demist</T>
            <T size={12} tone="muted">by Graceful Minds</T>
          </View>
        </View>

        {step === 'email' && (
          <>
            <T size={30} weight={700} style={{ marginBottom: 8 }}>Sign in</T>
            <T tone="muted" style={{ marginBottom: 28 }}>We will email you a 6-digit code. No password needed.</T>
            <TextInput
              style={input} value={email} onChangeText={setEmail}
              placeholder="you@university.ac.uk" placeholderTextColor={c.fgFaint}
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email"
              textContentType="emailAddress" returnKeyType="next" onSubmitEditing={sendCode}
              accessibilityLabel="Email address"
            />
            <Button label="Send code" onPress={sendCode} loading={loading} disabled={!email.trim()} />
          </>
        )}

        {step === 'code' && (
          <>
            <T size={30} weight={700} style={{ marginBottom: 8 }}>Check your email</T>
            <T tone="muted" style={{ marginBottom: 28 }}>We sent a code to {email.trim()}.</T>
            <TextInput
              ref={codeRef}
              style={[input, { fontSize: size(26), letterSpacing: 10, textAlign: 'center' }]}
              value={code} onChangeText={t => setCode(t.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000" placeholderTextColor={c.fgFaint}
              keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code"
              maxLength={6} onSubmitEditing={verify} accessibilityLabel="6-digit code"
            />
            <Button label="Continue" onPress={verify} loading={loading} disabled={code.length < 6} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 }}>
              <Pressable hitSlop={10} onPress={() => { setStep('email'); setCode(''); setError('') }} accessibilityRole="button">
                <T size={14} tone="muted">Use a different email</T>
              </Pressable>
              <Pressable hitSlop={10} disabled={cooldown > 0} onPress={sendCode} accessibilityRole="button">
                <T size={14} tone={cooldown > 0 ? 'faint' : 'accent'}>{cooldown > 0 ? `Send again in ${cooldown}s` : 'Send again'}</T>
              </Pressable>
            </View>
          </>
        )}

        {step === 'password' && (
          <>
            <T size={30} weight={700} style={{ marginBottom: 8 }}>Review account</T>
            <T tone="muted" style={{ marginBottom: 28 }}>Enter the password for {REVIEW_EMAIL}.</T>
            <TextInput style={input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"
              textContentType="password" onSubmitEditing={signInWithPassword} accessibilityLabel="Password" />
            <Button label="Sign in" onPress={signInWithPassword} loading={loading} disabled={!password} />
            <Pressable hitSlop={10} style={{ marginTop: 18 }} onPress={() => { setStep('email'); setPassword('') }} accessibilityRole="button">
              <T size={14} tone="muted">Back</T>
            </Pressable>
          </>
        )}

        {!!error && <T size={14} tone="danger" center style={{ marginTop: 14 }}>{error}</T>}

        <T size={12} tone="faint" center style={{ marginTop: 36 }}>By continuing you agree to our</T>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 4 }}>
          <Pressable onPress={() => Linking.openURL('https://demist.app/terms')} accessibilityRole="link" hitSlop={8}>
            <T size={12} tone="accent">Terms</T>
          </Pressable>
          <Pressable onPress={() => Linking.openURL('https://demist.app/privacy')} accessibilityRole="link" hitSlop={8}>
            <T size={12} tone="accent">Privacy Policy</T>
          </Pressable>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  )
}
