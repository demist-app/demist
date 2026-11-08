// My Space on iPhone, the same three parts as web/app/(app)/space/page.tsx:
// what helps right now (their toolbox), one thing at a time (priorities) and
// words for when it's hard. Same rules: one glance should be enough, nothing
// scores or guilts, nothing moves a task on its own, how they feel is never
// stored, and nothing they write reaches analytics.
import { useCallback, useMemo, useRef, useState } from 'react'
import { Linking, Pressable, ScrollView, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { usePrefs } from '../../lib/prefs'
import { useAccount } from '../../lib/account'
import { capture } from '../../lib/analytics'
import { radius } from '../../lib/theme'
import { Button, Card, Chip, Input, ReadAloud, SectionLabel, T } from '../../components/ui'
import { FEELINGS, TOPICS, CRISIS_LINES, type Feeling, type Topic } from '../../lib/shared/mySpaceContent'
import {
  loadSpace, insertRow, updateRow, deleteRow, localDay, TASK_COLS, TOOLBOX_COLS, MESSAGE_COLS,
  type SpaceTask, type ToolboxItem, type SpaceMessage,
} from '../../lib/mySpace'

type When = 'today' | 'tomorrow' | 'later'
const WHEN_LABEL: Record<When, string> = { today: 'Today', tomorrow: 'Tomorrow', later: 'Later' }

function whenOf(t: SpaceTask, today: string, tomorrow: string): When {
  if (!t.plan_date) return 'later'
  if (t.plan_date <= today) return 'today'
  if (t.plan_date === tomorrow) return 'tomorrow'
  return 'later'
}

export default function MySpace() {
  const { session } = useAccount()
  const { c } = usePrefs()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [tasks, setTasks] = useState<SpaceTask[]>([])
  const [toolbox, setToolbox] = useState<ToolboxItem[]>([])
  const [messages, setMessages] = useState<SpaceMessage[]>([])
  const scroll = useRef<ScrollView>(null)
  const prioritiesY = useRef(0)
  const opened = useRef(false)

  // Reloaded on every visit to the tab, so changes made on the website show up.
  useFocusEffect(useCallback(() => {
    if (!session?.user.id) return
    void loadSpace().then(data => {
      if (!data) { setState('failed'); return }
      setTasks(data.tasks); setToolbox(data.toolbox); setMessages(data.messages)
      setState('ready')
      if (!opened.current) { opened.current = true; capture('my_space_opened', { tasks: data.tasks.length }) }
    })
  }, [session?.user.id]))

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
        <View style={{ paddingTop: 16, paddingBottom: 12 }}>
          <T size={28} weight={700} style={{ letterSpacing: -0.4 }}>My Space</T>
          <T tone="muted" style={{ marginTop: 4 }}>Just for you. Nobody else can see what you write here.</T>
        </View>

        {state === 'loading' && <T tone="muted">Opening your space…</T>}
        {state === 'failed' && (
          <Card><T>My Space could not open just now. Check your connection, then come back to this tab.</T></Card>
        )}
        {state === 'ready' && (
          <>
            <RightNow toolbox={toolbox} setToolbox={setToolbox}
              onMakeTodaySmaller={() => scroll.current?.scrollTo({ y: prioritiesY.current, animated: true })} />
            <View onLayout={e => { prioritiesY.current = e.nativeEvent.layout.y }}>
              <Priorities tasks={tasks} setTasks={setTasks} />
            </View>
            <Words messages={messages} setMessages={setMessages} />
          </>
        )}

        <CrisisLines />
      </ScrollView>
    </SafeAreaView>
  )
}

// ── What would help right now? ────────────────────────────────────────────────

function RightNow({ toolbox, setToolbox, onMakeTodaySmaller }: {
  toolbox: ToolboxItem[]
  setToolbox: React.Dispatch<React.SetStateAction<ToolboxItem[]>>
  onMakeTodaySmaller: () => void
}) {
  const { c } = usePrefs()
  const [feeling, setFeeling] = useState<Feeling | null>(null)
  const items = toolbox.filter(t => t.feeling === feeling)

  const add = async (text: string) => {
    if (!feeling) return
    const position = items.reduce((m, t) => Math.max(m, t.position), -1) + 1
    const row = await insertRow<ToolboxItem>('my_space_toolbox', { feeling, text, position }, TOOLBOX_COLS)
    if (row) { setToolbox(prev => [...prev, row]); capture('my_space_toolbox_added') }
  }
  const save = async (id: string, text: string) => {
    if (await updateRow('my_space_toolbox', id, { text })) setToolbox(prev => prev.map(t => t.id === id ? { ...t, text } : t))
  }
  const remove = async (id: string) => {
    if (await deleteRow('my_space_toolbox', id)) { setToolbox(prev => prev.filter(t => t.id !== id)); capture('my_space_toolbox_removed') }
  }

  return (
    <View>
      <SectionLabel>What would help right now?</SectionLabel>
      <View style={{ gap: 10 }}>
        {FEELINGS.map(f => {
          const on = feeling === f.value
          return (
            <Pressable key={f.value} accessibilityRole="button" accessibilityState={{ selected: on }}
              onPress={() => {
                const next = on ? null : f.value
                setFeeling(next)
                // Which feeling is deliberately not recorded.
                if (next) capture('my_space_feeling_opened')
              }}
              style={({ pressed }) => ({
                borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: 16, minHeight: 52, justifyContent: 'center',
                borderColor: on ? c.accentBorder : c.border, backgroundColor: on ? c.accentSoft : c.surface,
                opacity: pressed ? 0.85 : 1,
              })}>
              <T weight={on ? 600 : 500} tone={on ? 'accent' : 'fg'}>{f.label}</T>
            </Pressable>
          )
        })}
      </View>

      {feeling && (
        <View style={{ marginTop: 14 }}>
          <T size={13} tone="muted" style={{ marginBottom: 10 }}>Try one. Change, remove or add to these so they fit what helps you.</T>
          {feeling === 'overwhelmed' && (
            <Pressable onPress={onMakeTodaySmaller} accessibilityRole="link" style={{ marginBottom: 10 }}>
              <T weight={600} tone="accent">Make today smaller: choose one thing</T>
            </Pressable>
          )}
          <EditableList
            items={items.map(t => ({ id: t.id, text: t.text }))}
            onSave={save} onDelete={remove} onAdd={add}
            addLabel="Add something that helps you"
            empty="Nothing here yet. Add something that has helped you before."
          />
        </View>
      )}
    </View>
  )
}

// ── One thing at a time ───────────────────────────────────────────────────────

function Priorities({ tasks, setTasks }: {
  tasks: SpaceTask[]
  setTasks: React.Dispatch<React.SetStateAction<SpaceTask[]>>
}) {
  const { c, font, size } = usePrefs()
  const today = localDay(0)
  const tomorrow = localDay(1)
  const open = tasks.filter(t => !t.done_at)
  const done = tasks.filter(t => t.done_at).sort((a, b) => (b.done_at! > a.done_at! ? 1 : -1))
  const doneToday = done.filter(t => new Date(t.done_at!).toDateString() === new Date().toDateString())
  const [draft, setDraft] = useState('')
  const [draftWhen, setDraftWhen] = useState<When>('today')
  const dateFor = (w: When) => (w === 'today' ? today : w === 'tomorrow' ? tomorrow : null)

  const add = async () => {
    const title = draft.trim().slice(0, 200)
    if (!title) return
    const row = await insertRow<SpaceTask>('my_space_tasks', { title, plan_date: dateFor(draftWhen) }, TASK_COLS)
    if (row) { setTasks(prev => [...prev, row]); setDraft(''); capture('my_space_task_added', { when: draftWhen }) }
  }
  const patch = async (id: string, change: Partial<SpaceTask>) => {
    if (await updateRow('my_space_tasks', id, change)) setTasks(prev => prev.map(t => t.id === id ? { ...t, ...change } : t))
  }
  const remove = async (id: string) => {
    if (await deleteRow('my_space_tasks', id)) setTasks(prev => prev.filter(t => t.id !== id))
  }

  return (
    <View>
      <SectionLabel>One thing at a time</SectionLabel>
      <T tone="muted" style={{ marginBottom: 12 }}>You don’t have to do everything today. Choose what matters, and move the rest without guilt.</T>

      {doneToday.length > 0 && (
        <View style={{ backgroundColor: c.accentSoft, borderRadius: radius.lg, padding: 14, marginBottom: 12 }}>
          <T>You’ve done {doneToday.length === 1 ? 'one thing' : `${doneToday.length} things`} today.</T>
        </View>
      )}

      <Input value={draft} onChangeText={setDraft} maxLength={200} placeholder="Add something to do"
        accessibilityLabel="Add something to do" returnKeyType="done" onSubmitEditing={() => void add()}
        style={{ fontFamily: font(400), fontSize: size(16), color: c.fg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, paddingHorizontal: 16, minHeight: 52 }} />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['today', 'tomorrow', 'later'] as When[]).map(w => (
          <Chip key={w} label={WHEN_LABEL[w]} selected={draftWhen === w} onPress={() => setDraftWhen(w)} />
        ))}
        <Button label="Add" onPress={() => void add()} disabled={!draft.trim()} style={{ marginLeft: 'auto', minHeight: 40 }} />
      </View>

      {(['today', 'tomorrow', 'later'] as When[]).map(w => {
        const items = open.filter(t => whenOf(t, today, tomorrow) === w)
        return (
          <View key={w}>
            <SectionLabel>{WHEN_LABEL[w]}</SectionLabel>
            {items.length === 0
              ? <T tone="faint">{w === 'today' ? 'Nothing for today. That is allowed.' : 'Nothing here.'}</T>
              : <View style={{ gap: 8 }}>
                  {items.map(t => (
                    <TaskRow key={t.id} task={t} when={w}
                      onDone={() => { void patch(t.id, { done_at: new Date().toISOString() }); capture('my_space_task_done') }}
                      onMove={to => void patch(t.id, { plan_date: dateFor(to) })}
                      onDeadline={() => void patch(t.id, { deadline: !t.deadline })}
                      onRename={title => void patch(t.id, { title })}
                      onDelete={() => void remove(t.id)} />
                  ))}
                </View>}
          </View>
        )
      })}

      {done.length > 0 && (
        <View>
          <SectionLabel>Done this week</SectionLabel>
          <View style={{ gap: 8 }}>
            {done.map(t => (
              <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <T tone="muted">✓</T>
                <T tone="muted" style={{ flex: 1, textDecorationLine: 'line-through' }}>{t.title}</T>
                <Pressable onPress={() => void patch(t.id, { done_at: null })} accessibilityRole="button" hitSlop={8}>
                  <T size={13} tone="accent">Not done</T>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  )
}

function TaskRow({ task, when, onDone, onMove, onDeadline, onRename, onDelete }: {
  task: SpaceTask; when: When
  onDone: () => void; onMove: (w: When) => void; onDeadline: () => void
  onRename: (title: string) => void; onDelete: () => void
}) {
  const { c, font, size } = usePrefs()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(task.title)
  const others = (['today', 'tomorrow', 'later'] as When[]).filter(w => w !== when)

  return (
    <Card style={{ paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel={`Mark ${task.title} as done`} hitSlop={10}
          style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.accent }} />
        {editing ? (
          <View style={{ flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Input value={text} onChangeText={setText} maxLength={200} autoFocus accessibilityLabel="Edit task"
              onSubmitEditing={() => { const t = text.trim(); if (t) { onRename(t); setEditing(false) } }}
              style={{ flex: 1, fontFamily: font(400), fontSize: size(15), color: c.fg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 10, minHeight: 40 }} />
            <Pressable onPress={() => { const t = text.trim(); if (t) { onRename(t); setEditing(false) } }} hitSlop={8}>
              <T weight={600} tone="accent">Save</T>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setOpen(o => !o)} style={{ flex: 1 }} accessibilityRole="button" accessibilityHint="Shows options for this task">
            <T>{task.title}</T>
            {task.deadline && <T size={11} weight={700} tone="accent" style={{ marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Deadline</T>}
          </Pressable>
        )}
      </View>
      {open && !editing && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 12, paddingLeft: 36 }}>
          {others.map(w => (
            <Pressable key={w} onPress={() => { onMove(w); setOpen(false) }} hitSlop={6}><T size={14} tone="accent">Move to {WHEN_LABEL[w]}</T></Pressable>
          ))}
          <Pressable onPress={onDeadline} hitSlop={6}><T size={14} tone="accent">{task.deadline ? 'Not a deadline' : 'Mark as a deadline'}</T></Pressable>
          <Pressable onPress={() => { setEditing(true); setOpen(false) }} hitSlop={6}><T size={14} tone="accent">Edit</T></Pressable>
          <Pressable onPress={onDelete} hitSlop={6}><T size={14} tone="danger">Delete</T></Pressable>
        </View>
      )}
    </Card>
  )
}

// ── Words for when it's hard ─────────────────────────────────────────────────

function Words({ messages, setMessages }: {
  messages: SpaceMessage[]
  setMessages: React.Dispatch<React.SetStateAction<SpaceMessage[]>>
}) {
  const [topic, setTopic] = useState<Topic | 'favourites'>('favourites')
  const favourites = messages.filter(m => m.favourite)
  const active: Topic | 'favourites' = topic === 'favourites' && favourites.length === 0 ? 'life' : topic
  const shown = useMemo(() => active === 'favourites' ? favourites : messages.filter(m => m.topic === active), [active, messages, favourites])

  const add = async (text: string) => {
    const t: Topic = active === 'favourites' ? 'life' : active
    const row = await insertRow<SpaceMessage>('my_space_messages', { topic: t, text, favourite: active === 'favourites' }, MESSAGE_COLS)
    if (row) { setMessages(prev => [...prev, row]); capture('my_space_message_added') }
  }
  const save = async (id: string, text: string) => {
    if (await updateRow('my_space_messages', id, { text })) setMessages(prev => prev.map(m => m.id === id ? { ...m, text } : m))
  }
  const remove = async (id: string) => {
    if (await deleteRow('my_space_messages', id)) setMessages(prev => prev.filter(m => m.id !== id))
  }
  const toggleFavourite = async (id: string) => {
    const m = messages.find(x => x.id === id)
    if (m && await updateRow('my_space_messages', id, { favourite: !m.favourite })) {
      setMessages(prev => prev.map(x => x.id === id ? { ...x, favourite: !x.favourite } : x))
    }
  }

  const chips: { value: Topic | 'favourites'; label: string }[] = [
    ...(favourites.length ? [{ value: 'favourites' as const, label: 'Favourites' }] : []),
    ...TOPICS,
  ]

  return (
    <View>
      <SectionLabel>Words for when it’s hard</SectionLabel>
      <T tone="muted" style={{ marginBottom: 12 }}>We wrote these to start you off. Keep the ones that help, change or remove the rest, and add your own.</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {chips.map(ch => <Chip key={ch.value} label={ch.label} selected={active === ch.value} onPress={() => setTopic(ch.value)} />)}
      </View>
      <EditableList
        items={shown.map(m => ({ id: m.id, text: m.text, favourite: m.favourite }))}
        onSave={save} onDelete={remove} onAdd={add} onFavourite={toggleFavourite} readAloud
        addLabel="Add your own"
        empty="Nothing here yet. Add words that help you."
      />
    </View>
  )
}

// ── Shared: a list where every item can be edited or removed ─────────────────

function EditableList({ items, onSave, onDelete, onAdd, onFavourite, readAloud, addLabel, empty }: {
  items: { id: string; text: string; favourite?: boolean }[]
  onSave: (id: string, text: string) => void
  onDelete: (id: string) => void
  onAdd: (text: string) => void
  onFavourite?: (id: string) => void
  readAloud?: boolean
  addLabel: string
  empty: string
}) {
  const { c, font, size } = usePrefs()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [adding, setAdding] = useState(false)
  const [newText, setNewText] = useState('')
  const field = { flex: 1, fontFamily: font(400), fontSize: size(15), color: c.fg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 10, minHeight: 44 }

  const commitEdit = (id: string) => { const t = editText.trim().slice(0, 300); if (t) { onSave(id, t); setEditingId(null) } }
  const commitAdd = () => { const t = newText.trim().slice(0, 300); if (t) { onAdd(t); setNewText(''); setAdding(false) } }

  return (
    <View>
      {items.length === 0 && <T tone="faint" style={{ marginBottom: 10 }}>{empty}</T>}
      <View style={{ gap: 8 }}>
        {items.map(item => (
          <Card key={item.id} style={{ paddingVertical: 12 }}>
            {editingId === item.id ? (
              <View style={{ gap: 10 }}>
                <Input value={editText} onChangeText={setEditText} maxLength={300} autoFocus multiline accessibilityLabel="Edit" style={field} />
                <View style={{ flexDirection: 'row', gap: 20 }}>
                  <Pressable onPress={() => commitEdit(item.id)} hitSlop={8}><T weight={600} tone="accent">Save</T></Pressable>
                  <Pressable onPress={() => setEditingId(null)} hitSlop={8}><T tone="muted">Cancel</T></Pressable>
                </View>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                <T style={{ lineHeight: size(15) * 1.5 }}>{item.text}</T>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
                  {readAloud && <ReadAloud text={item.text} label="Read this aloud" />}
                  {onFavourite && (
                    <Pressable onPress={() => onFavourite(item.id)} hitSlop={8} accessibilityRole="button"
                      accessibilityState={{ selected: !!item.favourite }}
                      accessibilityLabel={item.favourite ? 'Remove from favourites' : 'Add to favourites'}>
                      <T size={18} tone={item.favourite ? 'accent' : 'faint'}>{item.favourite ? '★' : '☆'}</T>
                    </Pressable>
                  )}
                  <Pressable onPress={() => { setEditingId(item.id); setEditText(item.text) }} hitSlop={8}><T size={14} tone="accent">Edit</T></Pressable>
                  <Pressable onPress={() => onDelete(item.id)} hitSlop={8}><T size={14} tone="muted">Remove</T></Pressable>
                </View>
              </View>
            )}
          </Card>
        ))}
      </View>
      {adding ? (
        <View style={{ gap: 10, marginTop: 10 }}>
          <Input value={newText} onChangeText={setNewText} maxLength={300} autoFocus multiline placeholder={addLabel} accessibilityLabel={addLabel} style={field} />
          <View style={{ flexDirection: 'row', gap: 20 }}>
            <Pressable onPress={commitAdd} hitSlop={8}><T weight={600} tone="accent">Add</T></Pressable>
            <Pressable onPress={() => setAdding(false)} hitSlop={8}><T tone="muted">Cancel</T></Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setAdding(true)} hitSlop={8} style={{ marginTop: 12 }} accessibilityRole="button">
          <T weight={600} tone="accent">+ {addLabel}</T>
        </Pressable>
      )}
    </View>
  )
}

// ── If you're not safe right now ─────────────────────────────────────────────

function CrisisLines() {
  return (
    <Card style={{ marginTop: 32 }}>
      <T size={16} weight={600}>If you’re not safe right now</T>
      <T tone="muted" style={{ marginTop: 4, marginBottom: 12 }}>You don’t have to manage this on your own. These are free and confidential.</T>
      <View style={{ gap: 10 }}>
        {CRISIS_LINES.map(l => (
          <Pressable key={l.name} disabled={!l.href} onPress={() => l.href && void Linking.openURL(l.href)} accessibilityRole="link">
            <T><T weight={600}>{l.name}: </T><T tone="accent" style={{ textDecorationLine: 'underline' }}>{l.detail}</T></T>
          </Pressable>
        ))}
      </View>
      <T size={12} tone="faint" style={{ marginTop: 12 }}>These numbers are for the UK. Elsewhere, call your local emergency number.</T>
    </Card>
  )
}
