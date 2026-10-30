// Lecturer permission per module: the phone's version of the web's
// ConsentModal/ConsentList (web/components/ConsentUnlock.tsx). A consent row
// is what lets a transcript and summary be kept, so a failed write is never
// shown as a saved one.
import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, Share, View } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../lib/supabase'
import { useAccount } from '../lib/account'
import { useRecording } from '../lib/recording'
import { usePrefs } from '../lib/prefs'
import { capture, reportWriteFailure } from '../lib/analytics'
import { radius } from '../lib/theme'
import { Button, Card, Screen, SectionLabel, T, Input } from '../components/ui'

interface Consent { id: string; module_name: string; granted_at: string; notes: string | null }

function emailTemplate(module: string) {
  return `Subject: Permission to use a study aid during ${module} lectures

Dear [Lecturer name],

I use an app called Demist to help me follow technical words during your lectures. It listens through my phone's microphone, explains subject-specific words as they come up, and turns them into flashcards. It doesn't share recordings with anyone.

I'd like to ask for your permission to use it during ${module} sessions. The app asks for written permission before it keeps any transcript or summary.

If you're happy to give permission, a simple reply to this email is enough.

Thank you for your time.
[Your name]`
}

export default function Consents() {
  const { session, profile } = useAccount()
  const { subject } = useRecording()
  const { c, font, size } = usePrefs()
  const [list, setList] = useState<Consent[]>([])
  const [module, setModule] = useState(subject || profile?.course || '')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('lecturer_consents').select('id, module_name, granted_at, notes').order('granted_at', { ascending: false })
    setList((data as Consent[]) ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    const uid = session?.user.id
    const name = module.trim()
    if (!uid || !name) return
    setSaving(true)
    const { error } = await supabase.from('lecturer_consents').upsert({
      user_id: uid, module_name: name, notes: notes.trim() || null, granted_at: new Date().toISOString(),
    }, { onConflict: 'user_id,module_name' })
    setSaving(false)
    if (reportWriteFailure('consent.grant', error)) { Alert.alert('Not saved', "Couldn't record that permission. Please try again."); return }
    capture('consent_granted', { platform: 'ios' })
    setNotes('')
    await load()
  }

  const remove = (cn: Consent) => {
    Alert.alert(`Remove ${cn.module_name}?`, 'New lectures for this module will no longer keep a transcript or summary.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('lecturer_consents').delete().eq('id', cn.id)
        if (!reportWriteFailure('consent.delete', error)) await load()
      } },
    ])
  }

  const input = {
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 12, color: c.fg, fontFamily: font(400), fontSize: size(15),
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16 }}>
        <T size={24} weight={700}>Lecturer permission</T>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button"><T weight={600} tone="accent">Done</T></Pressable>
      </View>
      <T tone="muted" style={{ marginTop: 10 }}>
        Your lecturer owns the rights to their live lecture. Once they have said yes in writing, add the module here and Demist will keep transcripts and summaries for it.
      </T>

      <SectionLabel>Ask your lecturer</SectionLabel>
      <Button kind="secondary" label="Share an email you can send" onPress={() => {
        capture('consent_template_copied', { platform: 'ios' })
        void Share.share({ message: emailTemplate(module.trim() || 'my module') })
      }} />

      <SectionLabel>Add a module</SectionLabel>
      <View style={{ gap: 10 }}>
        <Input style={input} value={module} onChangeText={setModule} placeholder="Module name, as you type it when recording"
          placeholderTextColor={c.fgFaint} accessibilityLabel="Module name" />
        <Input style={input} value={notes} onChangeText={setNotes} placeholder="Notes (optional), e.g. email reply received 30 June"
          placeholderTextColor={c.fgFaint} maxLength={300} accessibilityLabel="Notes" />
        <Button label="My lecturer has said yes" onPress={save} loading={saving} disabled={!module.trim()} />
      </View>

      <SectionLabel>Modules with permission</SectionLabel>
      {list.length === 0 ? <T tone="muted">None yet.</T> : (
        <View style={{ gap: 8 }}>
          {list.map(cn => (
            <Card key={cn.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
              <View style={{ flex: 1 }}>
                <T weight={600}>{cn.module_name}</T>
                <T size={12} tone="faint">Added {new Date(cn.granted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}{cn.notes ? ` · ${cn.notes}` : ''}</T>
              </View>
              <Pressable onPress={() => remove(cn)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${cn.module_name}`}>
                <T size={14} weight={600} tone="danger">Remove</T>
              </Pressable>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  )
}
