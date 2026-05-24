import { useEffect, useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'

interface Term {
  id: string
  term: string
  definition: string
  known: boolean
  session_id: string
}

interface Session {
  id: string
  subject: string | null
  started_at: string
  terms: Term[]
}

function fmtLabel(subject: string | null, startedAt: string): string {
  if (subject) return subject
  const d = new Date(startedAt)
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

export default function Glossary() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: sessionsRaw } = await supabase
        .from('sessions')
        .select('id, subject, started_at')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false })
        .limit(50)

      if (!sessionsRaw?.length) { setLoading(false); return }

      const { data: termsRaw } = await supabase
        .from('terms')
        .select('id, term, definition, known, session_id')
        .in('session_id', sessionsRaw.map(s => s.id))
        .order('created_at', { ascending: true })

      const termMap: Record<string, Term[]> = {}
      for (const t of termsRaw ?? []) {
        if (!termMap[t.session_id]) termMap[t.session_id] = []
        termMap[t.session_id].push(t as Term)
      }

      setSessions(sessionsRaw.map(s => ({ ...s, terms: termMap[s.id] ?? [] })))
      setLoading(false)
    })()
  }, [])

  const toggleKnown = async (termId: string, currently: boolean) => {
    await supabase.from('terms').update({ known: !currently }).eq('id', termId)
    setSessions(prev =>
      prev.map(s => ({
        ...s,
        terms: s.terms.map(t => t.id === termId ? { ...t, known: !currently } : t),
      }))
    )
  }

  if (loading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator color="#7c3aed" />
      </View>
    )
  }

  if (!sessions.length) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}><Text style={s.headerTitle}>Glossary</Text></View>
        <View style={s.center}>
          <Text style={s.emptyText}>No sessions yet.</Text>
          <Text style={s.emptySubtext}>Use the web app to record a lecture.</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}><Text style={s.headerTitle}>Glossary</Text></View>
      <FlatList
        data={sessions}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item: session }) => {
          const expanded = expandedId === session.id
          return (
            <View style={s.sessionCard}>
              <TouchableOpacity
                style={s.sessionHeader}
                onPress={() => setExpandedId(expanded ? null : session.id)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.sessionTitle} numberOfLines={1}>
                    {fmtLabel(session.subject, session.started_at)}
                  </Text>
                  <Text style={s.sessionMeta}>
                    {new Date(session.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </Text>
                </View>
                <View style={s.termCount}>
                  <Text style={s.termCountNum}>{session.terms.length}</Text>
                  <Text style={s.termCountLabel}>terms</Text>
                </View>
                <Text style={[s.chevron, expanded && s.chevronUp]}>›</Text>
              </TouchableOpacity>

              {expanded && (
                <View style={s.termList}>
                  {session.terms.length === 0 && (
                    <Text style={s.emptySubtext}>No terms detected.</Text>
                  )}
                  {session.terms.map(term => (
                    <View key={term.id} style={s.termRow}>
                      <View style={s.dot} />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.termName, term.known && s.termKnown]}>{term.term}</Text>
                        <Text style={s.termDef}>{term.definition}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => toggleKnown(term.id, term.known)}
                        style={s.knownBtn}
                        hitSlop={8}
                      >
                        <Text style={[s.checkmark, term.known && s.checkmarkActive]}>✓</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )
        }}
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080810' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  emptyText: { color: '#4b5563', fontSize: 15 },
  emptySubtext: { color: '#374151', fontSize: 13, marginTop: 4 },
  sessionCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 18, overflow: 'hidden',
  },
  sessionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  sessionTitle: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.9)' },
  sessionMeta: { fontSize: 12, color: '#4b5563', marginTop: 2 },
  termCount: { marginRight: 12, alignItems: 'flex-end' },
  termCountNum: { fontSize: 16, fontWeight: '600', color: '#a78bfa' },
  termCountLabel: { fontSize: 11, color: '#4b5563' },
  chevron: { fontSize: 20, color: '#4b5563', transform: [{ rotate: '90deg' }] },
  chevronUp: { transform: [{ rotate: '-90deg' }] },
  termList: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  termRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(139,92,246,0.5)', marginTop: 7, flexShrink: 0 },
  termName: { fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.9)' },
  termKnown: { color: '#4b5563', textDecorationLine: 'line-through' },
  termDef: { fontSize: 12, color: '#6b7280', marginTop: 2, lineHeight: 18 },
  knownBtn: { paddingLeft: 8 },
  checkmark: { fontSize: 18, color: '#374151' },
  checkmarkActive: { color: '#10b981' },
})
