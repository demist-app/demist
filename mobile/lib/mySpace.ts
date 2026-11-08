// Data access for My Space on iPhone (migration 043), mirroring
// web/lib/mySpace.ts: same tables, same owner-only rules, same starter content
// (lib/shared/mySpaceContent.ts, generated from the web file).
//
// Nothing a student writes here is ever sent to analytics. Failure reports
// carry the operation and the error code only: this app's reportWriteFailure
// also sends the message, and a Postgres error can quote the failing row,
// which here is the student's own words.
import { supabase } from './supabase'
import { reportWriteFailure } from './analytics'
import { STARTER_TOOLBOX, STARTER_MESSAGES, type Feeling, type Topic } from './shared/mySpaceContent'

const report = (op: string, error: { code?: string | null } | null) =>
  reportWriteFailure(op, error ? { code: error.code ?? 'unknown', message: null } : null)

export interface SpaceTask { id: string; title: string; plan_date: string | null; deadline: boolean; done_at: string | null; created_at: string }
export interface ToolboxItem { id: string; feeling: Feeling; text: string; position: number; created_at: string }
export interface SpaceMessage { id: string; topic: Topic; text: string; favourite: boolean; created_at: string }
export interface SpaceData { tasks: SpaceTask[]; toolbox: ToolboxItem[]; messages: SpaceMessage[] }

export const TASK_COLS = 'id, title, plan_date, deadline, done_at, created_at'
export const TOOLBOX_COLS = 'id, feeling, text, position, created_at'
export const MESSAGE_COLS = 'id, topic, text, favourite, created_at'

// The student's own calendar day, not UTC.
export function localDay(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function loadSpace(): Promise<SpaceData | null> {
  // Copies the starters in on the first visit from any device; a no-op after.
  const { error: seedErr } = await supabase.rpc('my_space_seed', { toolbox: STARTER_TOOLBOX, messages: STARTER_MESSAGES })
  report('my_space.seed', seedErr)
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [tasks, toolbox, messages] = await Promise.all([
    supabase.from('my_space_tasks').select(TASK_COLS).or(`done_at.is.null,done_at.gte.${weekAgo}`).order('created_at'),
    supabase.from('my_space_toolbox').select(TOOLBOX_COLS).order('position').order('created_at'),
    supabase.from('my_space_messages').select(MESSAGE_COLS).order('created_at'),
  ])
  const failed = [tasks, toolbox, messages].find(r => r.error)
  if (failed?.error) {
    report('my_space.load', failed.error)
    return null
  }
  return {
    tasks: (tasks.data ?? []) as SpaceTask[],
    toolbox: (toolbox.data ?? []) as ToolboxItem[],
    messages: (messages.data ?? []) as SpaceMessage[],
  }
}

type Table = 'my_space_tasks' | 'my_space_toolbox' | 'my_space_messages'

export async function insertRow<T>(table: Table, row: Record<string, unknown>, columns: string): Promise<T | null> {
  const { data, error } = await supabase.from(table).insert(row).select(columns).single()
  if (report(`${table}.insert`, error)) return null
  return data as T
}

export async function updateRow(table: Table, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase.from(table).update(patch).eq('id', id)
  return !report(`${table}.update`, error)
}

export async function deleteRow(table: Table, id: string): Promise<boolean> {
  const { error } = await supabase.from(table).delete().eq('id', id)
  return !report(`${table}.delete`, error)
}
