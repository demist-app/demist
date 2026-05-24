import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { supabase } from '../../lib/supabase'

interface Profile {
  display_name: string | null
  course: string | null
  year_of_study: number | null
  is_public: boolean
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [email, setEmail] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [totalTerms, setTotalTerms] = useState(0)
  const [totalSessions, setTotalSessions] = useState(0)

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setEmail(user.email ?? '')
      setUserId(user.id)

      const [{ data: prof }, { count: tc }, { count: sc }] = await Promise.all([
        supabase.from('profiles').select('display_name, course, year_of_study, is_public').eq('id', user.id).single(),
        supabase.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      ])
      setProfile(prof as Profile)
      setTotalTerms(tc ?? 0)
      setTotalSessions(sc ?? 0)
    })()
  }, [])

  const togglePublic = async (value: boolean) => {
    if (!userId) return
    setProfile(p => p ? { ...p, is_public: value } : p)
    await supabase.from('profiles').update({ is_public: value }).eq('id', userId)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const name = profile?.display_name || email || '?'
  const initials = name.slice(0, 1).toUpperCase()

  if (!profile) return <View style={s.container} />

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}><Text style={s.headerTitle}>Profile</Text></View>

      <ScrollView contentContainerStyle={s.content}>
        {/* Avatar */}
        <View style={s.avatarRow}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.name} numberOfLines={1}>{profile.display_name || 'No name set'}</Text>
            <Text style={s.emailText} numberOfLines={1}>{email}</Text>
          </View>
        </View>

        {/* Stats */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statLabel}>Total terms</Text>
            <Text style={s.statValue}>{totalTerms}</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statLabel}>Sessions</Text>
            <Text style={s.statValue}>{totalSessions}</Text>
          </View>
        </View>

        {/* Course & year */}
        {(profile.course || profile.year_of_study) && (
          <View style={s.infoCard}>
            {profile.course && (
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Course</Text>
                <Text style={s.infoValue}>{profile.course}</Text>
              </View>
            )}
            {profile.year_of_study && (
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Year</Text>
                <Text style={s.infoValue}>Year {profile.year_of_study}</Text>
              </View>
            )}
          </View>
        )}

        {/* Public toggle */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Sharing</Text>
          <View style={s.toggleCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.toggleTitle}>Public profile</Text>
              <Text style={s.toggleSub}>Share your stats with others</Text>
            </View>
            <Switch
              value={profile.is_public}
              onValueChange={togglePublic}
              trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#7c3aed' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Sign out */}
        <TouchableOpacity style={s.signOutBtn} onPress={signOut} activeOpacity={0.7}>
          <Text style={s.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080810' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(139,92,246,0.2)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 22, fontWeight: '700', color: '#a78bfa' },
  name: { fontSize: 16, fontWeight: '600', color: '#fff' },
  emailText: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14,
  },
  statLabel: { fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 },
  statValue: { fontSize: 26, fontWeight: '700', color: '#fff', marginTop: 4 },
  infoCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 8,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  infoLabel: { fontSize: 14, color: '#6b7280' },
  infoValue: { fontSize: 14, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },
  section: { gap: 8 },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: '#4b5563', textTransform: 'uppercase', letterSpacing: 2 },
  toggleCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14,
  },
  toggleTitle: { fontSize: 14, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },
  toggleSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  signOutBtn: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 18, paddingVertical: 18, alignItems: 'center', marginTop: 8,
  },
  signOutText: { fontSize: 15, color: '#6b7280', fontWeight: '500' },
})
