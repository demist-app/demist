import { useCallback, useState } from 'react'
import { FlatList, RefreshControl, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'
import { useAccount } from '../../lib/account'
import { usePrefs } from '../../lib/prefs'
import { Card, Empty, Loading, T } from '../../components/ui'
import { ChevronIcon } from '../../components/icons'
import { lectureTitle, minutes } from '../../lib/format'

interface SessionRow {
  id: string
  name: string | null
  subject: string | null
  started_at: string
  ended_at: string | null
  synopsis: string | null
  terms: number
}

export default function History() {
  const { session, limits } = useAccount()
  const { c } = usePrefs()
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const uid = session?.user.id
    if (!uid) return
    let q = supabase.from('sessions').select('id, name, subject, started_at, ended_at, synopsis')
      .eq('user_id', uid).order('started_at', { ascending: false }).limit(200)
    if (limits.historyDays != null) q = q.gte('started_at', new Date(Date.now() - limits.historyDays * 86400000).toISOString())
    const { data } = await q
    const sessions = (data ?? []) as Omit<SessionRow, 'terms'>[]
    const counts: Record<string, number> = {}
    if (sessions.length) {
      const { data: t } = await supabase.from('terms').select('session_id').in('session_id', sessions.map(s => s.id))
      for (const r of t ?? []) counts[r.session_id] = (counts[r.session_id] ?? 0) + 1
    }
    setRows(sessions.map(s => ({ ...s, terms: counts[s.id] ?? 0 })))
  }, [session?.user.id, limits.historyDays])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  if (!rows) return <Loading />

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={rows}
        keyExtractor={r => r.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 10, maxWidth: 760, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={c.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} />}
        ListHeaderComponent={
          <View style={{ paddingTop: 16, marginBottom: 6 }}>
            <T size={28} weight={700}>Lectures</T>
            {/* Plain statement, no upgrade prompt: the iOS app does not sell
                anything (App Store 3.1.3(b)). Older lectures are not deleted. */}
            {limits.historyDays != null ? <T tone="muted">Showing the last {limits.historyDays} days.</T> : null}
          </View>
        }
        ListEmptyComponent={<Empty title="No lectures yet" body="Your recordings will be listed here, with their words and summaries." />}
        renderItem={({ item: s }) => {
          const mins = minutes(s)
          const date = new Date(s.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
          return (
            <Card onPress={() => router.push({ pathname: '/session/[id]', params: { id: s.id } })} accessibilityLabel={`${lectureTitle(s)}, ${date}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <T weight={700} numberOfLines={1}>{lectureTitle(s)}</T>
                  <T size={13} tone="faint">
                    {[date, mins ? `${mins} min` : null, s.terms ? `${s.terms} new ${s.terms === 1 ? 'word' : 'words'}` : null].filter(Boolean).join(' · ')}
                  </T>
                  {s.synopsis ? <T size={14} tone="muted" numberOfLines={2} style={{ marginTop: 6 }}>{s.synopsis}</T> : null}
                </View>
                <ChevronIcon color={c.fgFaint} />
              </View>
            </Card>
          )
        }}
      />
    </SafeAreaView>
  )
}
