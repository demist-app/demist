import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const NOTION_VERSION = '2022-06-28'

function notionHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }
}

// ---- PUSH helpers ----

async function pushGlossary(token: string, userId: string, supabase: ReturnType<typeof createServerClient>) {
  const { data: terms } = await supabase
    .from('terms')
    .select('term, definition, created_at, sessions(name, started_at)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (!terms?.length) return { ok: false, error: 'no_terms' }

  // Create a new page in the user's workspace to hold the glossary database
  const pageRes = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      parent: { type: 'workspace', workspace: true },
      icon: { type: 'emoji', emoji: '📖' },
      properties: {
        title: { title: [{ text: { content: 'Demist Glossary' } }] },
      },
      children: [],
    }),
  })

  if (!pageRes.ok) {
    const err = await pageRes.text()
    return { ok: false, error: 'page_create_failed', detail: err }
  }

  const page = await pageRes.json()

  // Create a database inside the page
  const dbRes = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: page.id },
      icon: { type: 'emoji', emoji: '📝' },
      title: [{ text: { content: 'Glossary Terms' } }],
      properties: {
        Term: { title: {} },
        Definition: { rich_text: {} },
        Session: { rich_text: {} },
        Date: { date: {} },
      },
    }),
  })

  if (!dbRes.ok) return { ok: false, error: 'db_create_failed' }
  const db = await dbRes.json()

  // Insert rows in batches of 10 (Notion rate limit friendly)
  const batches: typeof terms[] = []
  for (let i = 0; i < terms.length; i += 10) batches.push(terms.slice(i, i + 10))

  for (const batch of batches) {
    await Promise.all(batch.map(t => {
      const sessionName = (t.sessions as { name: string | null; started_at: string } | null)?.name
        ?? (t.sessions as { name: string | null; started_at: string } | null)?.started_at?.slice(0, 10)
        ?? ''
      return fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: notionHeaders(token),
        body: JSON.stringify({
          parent: { database_id: db.id },
          properties: {
            Term: { title: [{ text: { content: t.term } }] },
            Definition: { rich_text: [{ text: { content: t.definition } }] },
            Session: { rich_text: [{ text: { content: sessionName } }] },
            Date: { date: { start: t.created_at.slice(0, 10) } },
          },
        }),
      })
    }))
  }

  return { ok: true, page_url: page.url, term_count: terms.length }
}

async function pushSummaries(token: string, userId: string, supabase: ReturnType<typeof createServerClient>) {
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, name, started_at, synopsis, subject')
    .eq('user_id', userId)
    .not('synopsis', 'is', null)
    .order('started_at', { ascending: false })
    .limit(50)

  if (!sessions?.length) return { ok: false, error: 'no_sessions_with_synopsis' }

  const pageRes = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      parent: { type: 'workspace', workspace: true },
      icon: { type: 'emoji', emoji: '🧠' },
      properties: {
        title: { title: [{ text: { content: 'Demist Session Summaries' } }] },
      },
      children: sessions.map(s => ({
        object: 'block',
        type: 'toggle',
        toggle: {
          rich_text: [{
            text: {
              content: s.name ?? `Session ${s.started_at?.slice(0, 10) ?? ''}`,
            },
          }],
          children: [{
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ text: { content: s.synopsis ?? '' } }],
            },
          }],
        },
      })),
    }),
  })

  if (!pageRes.ok) return { ok: false, error: 'page_create_failed' }
  const page = await pageRes.json()
  return { ok: true, page_url: page.url, session_count: sessions.length }
}

// ---- PULL helpers ----

async function extractBlocksText(token: string, blockId: string, depth = 0): Promise<string> {
  if (depth > 2) return ''
  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`, {
    headers: notionHeaders(token),
  })
  if (!res.ok) return ''
  const data = await res.json()
  const lines: string[] = []
  for (const block of data.results ?? []) {
    const richText = block[block.type]?.rich_text ?? []
    const lineText = richText.map((r: { plain_text: string }) => r.plain_text).join('')
    if (lineText.trim()) lines.push(lineText)
    if (block.has_children) {
      const childText = await extractBlocksText(token, block.id, depth + 1)
      if (childText) lines.push(childText)
    }
  }
  return lines.join(' ')
}

// ---- Route handler ----

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: integration } = await supabase
    .from('integrations')
    .select('access_token')
    .eq('user_id', user.id)
    .eq('provider', 'notion')
    .single()

  if (!integration?.access_token) {
    return NextResponse.json({ error: 'notion_not_connected' }, { status: 400 })
  }

  const token = integration.access_token
  const body = await req.json()
  const { action } = body

  if (action === 'push_glossary') {
    const result = await pushGlossary(token, user.id, supabase)
    return NextResponse.json(result)
  }

  if (action === 'push_summaries') {
    const result = await pushSummaries(token, user.id, supabase)
    return NextResponse.json(result)
  }

  if (action === 'list_pages') {
    const searchRes = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: notionHeaders(token),
      body: JSON.stringify({ filter: { value: 'page', property: 'object' }, page_size: 20 }),
    })
    if (!searchRes.ok) return NextResponse.json({ error: 'search_failed' }, { status: 500 })
    const data = await searchRes.json()
    const pages = (data.results ?? []).map((p: { id: string; properties?: { title?: { title?: { plain_text: string }[] } } }) => ({
      id: p.id,
      title: p.properties?.title?.title?.[0]?.plain_text ?? 'Untitled',
    }))
    return NextResponse.json({ ok: true, pages })
  }

  if (action === 'pull_page') {
    const { page_id } = body
    if (!page_id) return NextResponse.json({ error: 'missing_page_id' }, { status: 400 })
    const text = await extractBlocksText(token, page_id)
    if (!text.trim()) return NextResponse.json({ error: 'empty_page' }, { status: 422 })
    return NextResponse.json({ ok: true, text })
  }

  if (action === 'disconnect') {
    await supabase.from('integrations').delete().eq('user_id', user.id).eq('provider', 'notion')
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}
