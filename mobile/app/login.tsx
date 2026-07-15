import { useState, useRef, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, StyleSheet, ActivityIndicator, TextInput as RNTextInput,
} from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../lib/supabase'

type Step = 'email' | 'code'

export default function Login() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [error, setError] = useState('')
  const codeRef = useRef<RNTextInput>(null)

  useEffect(() => {
    if (step === 'code') setTimeout(() => codeRef.current?.focus(), 100)
  }, [step])

  const handleSendCode = async () => {
    if (!email.trim()) return
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    })
    setLoading(false)
    if (error) { setError(error.message); return }
    setStep('code')
  }

  const handleVerifyCode = async () => {
    if (code.length < 6) return
    setLoading(true); setError('')
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })
    setLoading(false)
    if (error) { setError('Invalid or expired code. Try again.'); return }
    router.replace('/(tabs)/')
  }

  const handleResend = async () => {
    setResending(true); setError('')
    await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } })
    setResending(false); setResent(true)
    setTimeout(() => setResent(false), 3000)
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={s.inner}>
        <Text style={s.brand}>Demist</Text>

        {step === 'email' ? (
          <>
            <Text style={s.title}>Sign in</Text>
            <Text style={s.subtitle}>We'll send a code to your email.</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              placeholder="your@email.com"
              placeholderTextColor="#4b5563"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSendCode}
            />
            <TouchableOpacity
              style={[s.btn, (!email.trim() || loading) && s.btnDisabled]}
              onPress={handleSendCode}
              disabled={!email.trim() || loading}
              activeOpacity={0.8}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Send code</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={s.title}>Check your email</Text>
            <Text style={s.subtitle}>We sent a code to <Text style={s.emailHighlight}>{email}</Text></Text>
            <TextInput
              ref={codeRef}
              style={[s.input, s.codeInput]}
              value={code}
              onChangeText={t => setCode(t.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              placeholderTextColor="#374151"
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={handleVerifyCode}
            />
            <TouchableOpacity
              style={[s.btn, (code.length < 6 || loading) && s.btnDisabled]}
              onPress={handleVerifyCode}
              disabled={code.length < 6 || loading}
              activeOpacity={0.8}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Verify →</Text>}
            </TouchableOpacity>

            <View style={s.row}>
              <TouchableOpacity onPress={() => { setStep('email'); setCode(''); setError('') }}>
                <Text style={s.link}>← Different email</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleResend} disabled={resending}>
                <Text style={s.link}>
                  {resent ? 'Code sent ✓' : resending ? 'Sending…' : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {!!error && <Text style={s.error}>{error}</Text>}
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080810' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 40 },
  brand: { fontSize: 11, fontWeight: '700', letterSpacing: 3, color: 'rgba(251,191,36,0.75)', textTransform: 'uppercase', marginBottom: 40 },
  title: { fontSize: 32, fontWeight: '700', color: '#fff', letterSpacing: -0.5, marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#6b7280', marginBottom: 32, lineHeight: 22 },
  emailHighlight: { color: '#fff', fontWeight: '600' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 18, paddingHorizontal: 20, paddingVertical: 16,
    color: '#fff', fontSize: 15, marginBottom: 12,
  },
  codeInput: { fontSize: 24, letterSpacing: 12, textAlign: 'center', fontVariant: ['tabular-nums'] },
  btn: {
    backgroundColor: '#D97706', borderRadius: 18,
    paddingVertical: 18, alignItems: 'center', marginBottom: 16,
  },
  btnDisabled: { opacity: 0.3 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { color: '#6b7280', fontSize: 13 },
  error: { color: '#f87171', fontSize: 13, textAlign: 'center', marginTop: 12 },
})
