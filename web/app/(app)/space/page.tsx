'use client'

// My Space (2026-11-07): from a student's ideas, for the moment they are
// anxious, overwhelmed or alone with nobody to ask. Three parts on one calm
// page: what helps right now (their toolbox), today's priorities, and words
// for when it's hard. Free for everyone.
//
// Design rules, from who this is for (someone who may be panicking):
// - One glance should be enough. Few choices, nothing that blinks or scores.
// - Never guilt: what is done comes before what is left, an empty list is
//   fine, and nothing moves a task on its own (deadlines least of all).
// - Their words stay theirs: nothing typed here reaches analytics, and how
//   they feel is never stored (choosing a feeling only shows suggestions).

import { useEffect, useMemo, useRef, useState } from 'react'
import { capture } from '@/lib/analytics'
import { ReadAloudButton } from '@/components/ReadAloudButton'
import { FEELINGS, TOPICS, CRISIS_LINES, type Feeling, type Topic } from '@/lib/mySpaceContent'
import {
  loadSpace, insertRow, updateRow, deleteRow, localDay,
  type SpaceTask, type ToolboxItem, type SpaceMessage,
} from '@/lib/mySpace'

const TASK_COLS = 'id, title, plan_date, deadline, done_at, created_at'
const TOOLBOX_COLS = 'id, feeling, text, position, created_at'
const MESSAGE_COLS = 'id, topic, text, favourite, created_at'

type When = 'today' | 'tomorrow' | 'later'

function whenOf(t: SpaceTask, today: string, tomorrow: string): When {
  if (!t.plan_date) return 'later'
  if (t.plan_date <= today) return 'today'
  if (t.plan_date === tomorrow) return 'tomorrow'
  return 'later'
}

const card = { background: 'var(--surface)', border: '1px solid var(--border)' }

export default function MySpace() {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [tasks, setTasks] = useState<SpaceTask[]>([])
  const [toolbox, setToolbox] = useState<ToolboxItem[]>([])
  const [messages, setMessages] = useState<SpaceMessage[]>([])
  const prioritiesRef = useRef<HTMLElement>(null)

  useEffect(() => {
    loadSpace().then(data => {
      if (!data) { setFailed(true); setLoaded(true); return }
      setTasks(data.tasks); setToolbox(data.toolbox); setMessages(data.messages)
      setLoaded(true)
      capture('my_space_opened', { tasks: data.tasks.length })
    })
  }, [])

  return (
    <main className="min-h-dvh flex flex-col nav-bottom-pad" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="font-semibold text-[15px]">My Space</span>
      </header>

      <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-10">
        <div>
          <h1 className="hidden sm:block text-[26px] font-bold tracking-tight mb-1">My Space</h1>
          <p className="text-[14px]" style={{ color: 'var(--fg-muted)' }}>
            Just for you. Nobody else can see what you write here.
          </p>
        </div>

        {!loaded && <p className="text-[14px]" style={{ color: 'var(--fg-muted)' }}>Opening your space…</p>}
        {failed && (
          <p className="text-[14px] rounded-2xl px-4 py-3" style={card}>
            My Space could not open just now. Check your connection and try again in a moment.
          </p>
        )}

        {loaded && !failed && (
          <>
            <RightNow
              toolbox={toolbox}
              setToolbox={setToolbox}
              onMakeTodaySmaller={() => prioritiesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            />
            <section ref={prioritiesRef}>
              <Priorities tasks={tasks} setTasks={setTasks} />
            </section>
            <Words messages={messages} setMessages={setMessages} />
          </>
        )}

        <CrisisLines />
      </div>
    </main>
  )
}

// ── What would help right now? ────────────────────────────────────────────────

function RightNow({ toolbox, setToolbox, onMakeTodaySmaller }: {
  toolbox: ToolboxItem[]
  setToolbox: React.Dispatch<React.SetStateAction<ToolboxItem[]>>
  onMakeTodaySmaller: () => void
}) {
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
    <section>
      <h2 className="text-[19px] font-semibold mb-3">What would help right now?</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {FEELINGS.map(f => (
          <button
            key={f.value}
            onClick={() => {
              const next = feeling === f.value ? null : f.value
              setFeeling(next)
              // Which feeling is deliberately not recorded: see the file header.
              if (next) capture('my_space_feeling_opened')
            }}
            aria-pressed={feeling === f.value}
            className="text-left px-4 py-3.5 rounded-2xl text-[15px] font-medium transition-colors"
            style={feeling === f.value
              ? { background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--fg)' }
              : card}
          >
            {f.label}
          </button>
        ))}
      </div>

      {feeling && (
        <div className="mt-4">
          <p className="text-[13px] mb-3" style={{ color: 'var(--fg-muted)' }}>
            Try one. Change, remove or add to these so they fit what helps you.
          </p>
          {feeling === 'overwhelmed' && (
            <button onClick={onMakeTodaySmaller} className="mb-3 text-[14px] underline underline-offset-2" style={{ color: 'var(--accent)' }}>
              Make today smaller: choose one thing
            </button>
          )}
          <EditableList
            items={items.map(t => ({ id: t.id, text: t.text }))}
            onSave={save}
            onDelete={remove}
            onAdd={add}
            addLabel="Add something that helps you"
            empty="Nothing here yet. Add something that has helped you before."
          />
        </div>
      )}
    </section>
  )
}

// ── Priorities ────────────────────────────────────────────────────────────────

function Priorities({ tasks, setTasks }: {
  tasks: SpaceTask[]
  setTasks: React.Dispatch<React.SetStateAction<SpaceTask[]>>
}) {
  const today = localDay(0)
  const tomorrow = localDay(1)
  const open = tasks.filter(t => !t.done_at)
  const done = tasks.filter(t => t.done_at).sort((a, b) => (b.done_at! > a.done_at! ? 1 : -1))
  const doneToday = done.filter(t => new Date(t.done_at!).toDateString() === new Date().toDateString())
  const groups: { when: When; label: string; items: SpaceTask[] }[] = [
    { when: 'today', label: 'Today', items: open.filter(t => whenOf(t, today, tomorrow) === 'today') },
    { when: 'tomorrow', label: 'Tomorrow', items: open.filter(t => whenOf(t, today, tomorrow) === 'tomorrow') },
    { when: 'later', label: 'Later', items: open.filter(t => whenOf(t, today, tomorrow) === 'later') },
  ]
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
    <div>
      <h2 className="text-[19px] font-semibold mb-1">One thing at a time</h2>
      <p className="text-[14px] mb-4" style={{ color: 'var(--fg-muted)' }}>
        You don’t have to do everything today. Choose what matters, and move the rest without guilt.
      </p>

      {doneToday.length > 0 && (
        <p className="text-[14px] mb-4 rounded-2xl px-4 py-3" style={{ background: 'var(--accent-soft)' }}>
          You’ve done {doneToday.length === 1 ? 'one thing' : `${doneToday.length} things`} today.
        </p>
      )}

      <form
        onSubmit={e => { e.preventDefault(); void add() }}
        className="flex flex-col sm:flex-row gap-2 mb-5"
      >
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          maxLength={200}
          placeholder="Add something to do"
          aria-label="Add something to do"
          className="flex-1 px-4 py-3 rounded-2xl text-[15px] focus:outline-none"
          style={card}
        />
        <div className="flex gap-2">
          <select
            value={draftWhen}
            onChange={e => setDraftWhen(e.target.value as When)}
            aria-label="When"
            className="px-3 py-3 rounded-2xl text-[14px]"
            style={card}
          >
            <option value="today">Today</option>
            <option value="tomorrow">Tomorrow</option>
            <option value="later">Later</option>
          </select>
          <button type="submit" className="px-5 py-3 rounded-2xl text-[14px] font-semibold text-white bg-brand-600 hover:brightness-110">
            Add
          </button>
        </div>
      </form>

      <div className="space-y-6">
        {groups.map(g => (
          <div key={g.when}>
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.12em] mb-2" style={{ color: 'var(--fg-muted)' }}>{g.label}</h3>
            {g.items.length === 0 ? (
              <p className="text-[14px]" style={{ color: 'var(--fg-faint)' }}>
                {g.when === 'today' ? 'Nothing for today. That is allowed.' : 'Nothing here.'}
              </p>
            ) : (
              <ul className="space-y-2">
                {g.items.map(t => (
                  <TaskRow key={t.id} task={t} when={g.when}
                    onDone={() => { void patch(t.id, { done_at: new Date().toISOString() }); capture('my_space_task_done') }}
                    onMove={w => void patch(t.id, { plan_date: dateFor(w) })}
                    onDeadline={() => void patch(t.id, { deadline: !t.deadline })}
                    onRename={title => void patch(t.id, { title })}
                    onDelete={() => void remove(t.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        ))}

        {done.length > 0 && (
          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.12em] mb-2" style={{ color: 'var(--fg-muted)' }}>Done this week</h3>
            <ul className="space-y-1.5">
              {done.map(t => (
                <li key={t.id} className="flex items-center gap-3 text-[14px]" style={{ color: 'var(--fg-muted)' }}>
                  <span aria-hidden>✓</span>
                  <span className="flex-1 line-through decoration-1">{t.title}</span>
                  <button onClick={() => void patch(t.id, { done_at: null })} className="text-[12px] underline underline-offset-2">Not done</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function TaskRow({ task, when, onDone, onMove, onDeadline, onRename, onDelete }: {
  task: SpaceTask; when: When
  onDone: () => void; onMove: (w: When) => void; onDeadline: () => void
  onRename: (title: string) => void; onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(task.title)
  const others: When[] = (['today', 'tomorrow', 'later'] as When[]).filter(w => w !== when)
  const label = (w: When) => (w === 'today' ? 'Today' : w === 'tomorrow' ? 'Tomorrow' : 'Later')

  return (
    <li className="rounded-2xl px-4 py-3" style={card}>
      <div className="flex items-start gap-3">
        <button
          onClick={onDone}
          aria-label={`Mark "${task.title}" as done`}
          className="mt-0.5 w-5 h-5 rounded-full shrink-0"
          style={{ border: '2px solid var(--accent)' }}
        />
        {editing ? (
          <form className="flex-1 flex gap-2" onSubmit={e => { e.preventDefault(); const t = text.trim(); if (t) { onRename(t.slice(0, 200)); setEditing(false) } }}>
            <input value={text} onChange={e => setText(e.target.value)} maxLength={200} autoFocus aria-label="Edit task"
              className="flex-1 px-3 py-1.5 rounded-xl text-[15px] focus:outline-none" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }} />
            <button type="submit" className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>Save</button>
          </form>
        ) : (
          <button onClick={() => setOpen(o => !o)} className="flex-1 text-left text-[15px] leading-snug" aria-expanded={open}>
            {task.title}
            {task.deadline && (
              <span className="ml-2 text-[11px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full align-middle" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                Deadline
              </span>
            )}
          </button>
        )}
      </div>
      {open && !editing && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 pl-8 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
          {others.map(w => (
            <button key={w} onClick={() => { onMove(w); setOpen(false) }} className="underline underline-offset-2">Move to {label(w)}</button>
          ))}
          <button onClick={onDeadline} className="underline underline-offset-2">{task.deadline ? 'Not a deadline' : 'Mark as a deadline'}</button>
          <button onClick={() => { setEditing(true); setOpen(false) }} className="underline underline-offset-2">Edit</button>
          <button onClick={onDelete} className="underline underline-offset-2">Delete</button>
        </div>
      )}
    </li>
  )
}

// ── Words for when it's hard ─────────────────────────────────────────────────

function Words({ messages, setMessages }: {
  messages: SpaceMessage[]
  setMessages: React.Dispatch<React.SetStateAction<SpaceMessage[]>>
}) {
  const [topic, setTopic] = useState<Topic | 'favourites'>('favourites')
  const favourites = messages.filter(m => m.favourite)
  // Open on favourites only once there are some.
  const shown = useMemo(() => {
    const t = topic === 'favourites' && favourites.length === 0 ? 'life' : topic
    return t === 'favourites' ? favourites : messages.filter(m => m.topic === t)
  }, [topic, messages, favourites])
  const activeTopic: Topic | 'favourites' = topic === 'favourites' && favourites.length === 0 ? 'life' : topic

  const add = async (text: string) => {
    const t = activeTopic === 'favourites' ? 'life' : activeTopic
    const row = await insertRow<SpaceMessage>('my_space_messages', { topic: t, text, favourite: activeTopic === 'favourites' }, MESSAGE_COLS)
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
    <section>
      <h2 className="text-[19px] font-semibold mb-1">Words for when it’s hard</h2>
      <p className="text-[14px] mb-4" style={{ color: 'var(--fg-muted)' }}>
        We wrote these to start you off. Keep the ones that help, change or remove the rest, and add your own.
      </p>
      <div className="flex flex-wrap gap-2 mb-4" role="tablist">
        {chips.map(c => (
          <button
            key={c.value}
            role="tab"
            aria-selected={activeTopic === c.value}
            onClick={() => setTopic(c.value)}
            className="px-3.5 py-1.5 rounded-full text-[13px] font-medium"
            style={activeTopic === c.value
              ? { background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--fg)' }
              : card}
          >
            {c.label}
          </button>
        ))}
      </div>
      <EditableList
        items={shown.map(m => ({ id: m.id, text: m.text, favourite: m.favourite }))}
        onSave={save}
        onDelete={remove}
        onAdd={add}
        onFavourite={toggleFavourite}
        readAloud
        addLabel="Add your own"
        empty="Nothing here yet. Add words that help you."
      />
    </section>
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [adding, setAdding] = useState(false)
  const [newText, setNewText] = useState('')

  const field = 'flex-1 px-3 py-2 rounded-xl text-[15px] focus:outline-none'
  const fieldStyle = { background: 'var(--bg)', border: '1px solid var(--border)' }

  return (
    <div>
      {items.length === 0 && <p className="text-[14px] mb-3" style={{ color: 'var(--fg-faint)' }}>{empty}</p>}
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item.id} className="rounded-2xl px-4 py-3" style={card}>
            {editingId === item.id ? (
              <form className="flex gap-2" onSubmit={e => {
                e.preventDefault()
                const t = editText.trim().slice(0, 300)
                if (t) { onSave(item.id, t); setEditingId(null) }
              }}>
                <input value={editText} onChange={e => setEditText(e.target.value)} maxLength={300} autoFocus aria-label="Edit" className={field} style={fieldStyle} />
                <button type="submit" className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>Save</button>
                <button type="button" onClick={() => setEditingId(null)} className="text-[13px]" style={{ color: 'var(--fg-muted)' }}>Cancel</button>
              </form>
            ) : (
              <div className="flex items-start gap-3">
                <p className="flex-1 text-[15px] leading-relaxed">{item.text}</p>
                <div className="flex items-center gap-3 shrink-0 text-[12px]" style={{ color: 'var(--fg-muted)' }}>
                  {readAloud && <ReadAloudButton text={item.text} label="Read this aloud" />}
                  {onFavourite && (
                    <button onClick={() => onFavourite(item.id)} aria-pressed={!!item.favourite}
                      aria-label={item.favourite ? 'Remove from favourites' : 'Add to favourites'}
                      className="text-[16px] leading-none" style={{ color: item.favourite ? 'var(--accent)' : 'var(--fg-faint)' }}>
                      {item.favourite ? '★' : '☆'}
                    </button>
                  )}
                  <button onClick={() => { setEditingId(item.id); setEditText(item.text) }} className="underline underline-offset-2">Edit</button>
                  <button onClick={() => onDelete(item.id)} className="underline underline-offset-2">Remove</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <form className="flex gap-2 mt-3" onSubmit={e => {
          e.preventDefault()
          const t = newText.trim().slice(0, 300)
          if (t) { onAdd(t); setNewText(''); setAdding(false) }
        }}>
          <input value={newText} onChange={e => setNewText(e.target.value)} maxLength={300} autoFocus aria-label={addLabel} placeholder={addLabel} className={field} style={fieldStyle} />
          <button type="submit" className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>Add</button>
          <button type="button" onClick={() => setAdding(false)} className="text-[13px]" style={{ color: 'var(--fg-muted)' }}>Cancel</button>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-3 text-[14px] font-medium" style={{ color: 'var(--accent)' }}>
          + {addLabel}
        </button>
      )}
    </div>
  )
}

// ── If you're not safe right now ─────────────────────────────────────────────

function CrisisLines() {
  return (
    <section className="rounded-2xl px-5 py-5" style={card}>
      <h2 className="text-[16px] font-semibold mb-1">If you’re not safe right now</h2>
      <p className="text-[14px] mb-3" style={{ color: 'var(--fg-muted)' }}>
        You don’t have to manage this on your own. These are free and confidential.
      </p>
      <ul className="space-y-2 text-[14px]">
        {CRISIS_LINES.map(l => (
          <li key={l.name}>
            <span className="font-semibold">{l.name}: </span>
            {l.href ? <a href={l.href} className="underline underline-offset-2">{l.detail}</a> : l.detail}
          </li>
        ))}
      </ul>
      <p className="text-[12px] mt-3" style={{ color: 'var(--fg-faint)' }}>
        These numbers are for the UK. Elsewhere, call your local emergency number.
      </p>
    </section>
  )
}
