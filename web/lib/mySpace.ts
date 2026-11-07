'use client'

// Data access for My Space (migration 043). Every row is the student's own and
// readable only by them (RLS). Nothing a student writes here is ever passed to
// analytics: reportWriteFailure sends an op name and an error code, and the
// page's capture() calls send counts only.

import { createClient } from '@/lib/supabase'
import { reportWriteFailure } from '@/lib/analytics'
import { STARTER_TOOLBOX, STARTER_MESSAGES, type Feeling, type Topic } from '@/lib/mySpaceContent'

// The code only, never the message: a Postgres error can quote the failing row,
// which here is the student's own words (a CHECK violation prints the text).
const report = (op: string, error: { code?: string | null } | null) =>
  reportWriteFailure(op, error ? { code: error.code ?? 'unknown', message: null } : null)

export interface SpaceTask { id: string; title: string; plan_date: string | null; deadline: boolean; done_at: string | null; created_at: string }
export interface ToolboxItem { id: string; feeling: Feeling; text: string; position: number; created_at: string }
export interface SpaceMessage { id: string; topic: Topic; text: string; favourite: boolean; created_at: string }

export interface SpaceData { tasks: SpaceTask[]; toolbox: ToolboxItem[]; messages: SpaceMessage[] }

// The student's own calendar day, not UTC: "today" must mean their today.
export function localDay(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function loadSpace(): Promise<SpaceData | null> {
  const sb = createClient()
  // Copies the starters in on first visit; a no-op every time after.
  const { error: seedErr } = await sb.rpc('my_space_seed', { toolbox: STARTER_TOOLBOX, messages: STARTER_MESSAGES })
  report('my_space.seed', seedErr)
  // Done tasks older than a week stay in the table but are not needed here.
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [tasks, toolbox, messages] = await Promise.all([
    sb.from('my_space_tasks').select('id, title, plan_date, deadline, done_at, created_at')
      .or(`done_at.is.null,done_at.gte.${weekAgo}`).order('created_at'),
    sb.from('my_space_toolbox').select('id, feeling, text, position, created_at').order('position').order('created_at'),
    sb.from('my_space_messages').select('id, topic, text, favourite, created_at').order('created_at'),
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
  const { data, error } = await createClient().from(table).insert(row).select(columns).single()
  if (report(`${table}.insert`, error)) return null
  return data as T
}

export async function updateRow(table: Table, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await createClient().from(table).update(patch).eq('id', id)
  return !report(`${table}.update`, error)
}

export async function deleteRow(table: Table, id: string): Promise<boolean> {
  const { error } = await createClient().from(table).delete().eq('id', id)
  return !report(`${table}.delete`, error)
}
