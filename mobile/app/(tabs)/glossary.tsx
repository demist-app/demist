import { useCallback, useMemo, useState } from 'react'
import { Alert, FlatList, Pressable, RefreshControl, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'
import { useAccount } from '../../lib/account'
import { usePrefs } from '../../lib/prefs'
import { reportWriteFailure } from '../../lib/analytics'
import { radius } from '../../lib/theme'
import { Card, Chip, Empty, Loading, ReadAloud, T, Input } from '../../components/ui'

interface Term {
  id: string
  term: string
  definition: string
  subject: string | null
  known: boolean
  created_at: string
}

type Filter = 'all' | 'learning' | 'known'

export default function Glossary() {
  const { session } = useAccount()
  const { c, font, size } = usePrefs()
  const [terms, setTerms] = useState<Term[] | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const uid = session?.user.id
    if (!uid) return
    const { data } = await supabase.from('terms')
      .select('id, term, definition, subject, known, created_at')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(2000)
    setTerms((data as Term[]) ?? [])
  }, [session?.user.id])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (terms ?? []).filter(t =>
      (filter === 'all' || (filter === 'known') === !!t.known) &&
      (!q || t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q) || (t.subject ?? '').toLowerCase().includes(q)))
  }, [terms, query, filter])

  // The subject under each word only helps when there is more than one;
  // otherwise it is the same line repeated on every card.
  const manySubjects = useMemo(() => new Set((terms ?? []).map(t => (t.subject ?? '').trim().toLowerCase())).size > 1, [terms])

  const toggleKnown = async (t: Term) => {
    setTerms(prev => prev?.map(x => x.id === t.id ? { ...x, known: !t.known } : x) ?? null)
    const { error } = await supabase.from('terms').update({ known: !t.known }).eq('id', t.id)
    if (reportWriteFailure('terms.known', error)) setTerms(prev => prev?.map(x => x.id === t.id ? { ...x, known: t.known } : x) ?? null)
  }

  const remove = (t: Term) => {
    Alert.alert(`Remove "${t.term}"?`, 'It will be taken out of your glossary and flashcards.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('terms').delete().eq('id', t.id)
        if (!reportWriteFailure('terms.delete', error)) setTerms(prev => prev?.filter(x => x.id !== t.id) ?? null)
      } },
    ])
  }

  if (!terms) return <Loading />

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={shown}
        keyExtractor={t => t.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 10, maxWidth: 760, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={c.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 6 }}>
            <View style={{ paddingTop: 16 }}>
              <T size={28} weight={700}>Glossary</T>
              <T tone="muted">{terms.length} {terms.length === 1 ? 'word' : 'words'} from your lectures</T>
            </View>
            <Input
              value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={c.fgFaint}
              clearButtonMode="while-editing" accessibilityLabel="Search your glossary"
              style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, color: c.fg, fontFamily: font(400), fontSize: size(15) }}
            />
            <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
              <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
              <Chip label="Still learning" selected={filter === 'learning'} onPress={() => setFilter('learning')} />
              <Chip label="Known" selected={filter === 'known'} onPress={() => setFilter('known')} />
            </View>
          </View>
        }
        ListEmptyComponent={terms.length
          ? <Empty title="Nothing matches" body="Try a different word or filter." />
          : <Empty title="No words yet" body="Record a lecture and new words will collect here, with plain explanations." />}
        renderItem={({ item: t }) => {
          const expanded = open === t.id
          return (
            <Card onPress={() => setOpen(expanded ? null : t.id)} accessibilityLabel={`${t.term}. ${t.definition}`}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <T weight={700} tone={t.known ? 'muted' : 'fg'}>{t.term}</T>
                  {manySubjects && t.subject ? <T size={12} tone="faint">{t.subject}</T> : null}
                  <T size={15} tone="muted" style={{ marginTop: 6 }} numberOfLines={expanded ? undefined : 2}>{t.definition}</T>
                </View>
                <ReadAloud text={`${t.term}. ${t.definition}`} />
              </View>
              {expanded && (
                <View style={{ flexDirection: 'row', gap: 18, marginTop: 14 }}>
                  <Pressable onPress={() => toggleKnown(t)} hitSlop={8} accessibilityRole="button">
                    <T size={14} weight={600} tone="accent">{t.known ? 'Mark as still learning' : 'I know this'}</T>
                  </Pressable>
                  <Pressable onPress={() => remove(t)} hitSlop={8} accessibilityRole="button">
                    <T size={14} weight={600} tone="danger">Remove</T>
                  </Pressable>
                </View>
              )}
            </Card>
          )
        }}
      />
    </SafeAreaView>
  )
}
