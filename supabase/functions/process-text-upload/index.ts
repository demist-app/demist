import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Split text into chunks of ~400 words, returning at most maxChunks chunks
function chunkText(text: string, maxChunks = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const chunkSize = 400
  const chunks: string[] = []
  for (let i = 0; i < words.length && chunks.length < maxChunks; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(' '))
  }
  return chunks
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'missing_auth' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authErr || !user) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { text, session_name, subject, year_of_study, source } = await req.json()
    if (!text?.trim()) {
      return new Response(JSON.stringify({ ok: false, error: 'missing_text' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Trim to at most 1200 words for the transcript column to keep storage small
    const transcriptForDb = text.split(/\s+/).slice(0, 1200).join(' ')

    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .insert({
        user_id: user.id,
        name: session_name ?? null,
        subject: subject ?? null,
        year_of_study: year_of_study ?? null,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        transcript: transcriptForDb,
        source: source ?? 'text_upload',
      })
      .select('id')
      .single()

    if (sessionErr || !session) {
      return new Response(JSON.stringify({ ok: false, error: 'session_insert_failed', detail: sessionErr?.message }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const sessionId = session.id
    const base = supabaseUrl
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Run term detection on at most 3 chunks of 400 words (cost control)
    const chunks = chunkText(text, 3)
    const allTerms: { term: string; definition: string }[] = []
    const seen = new Set<string>()

    await Promise.all(chunks.map(async (chunk) => {
      const dtRes = await fetch(`${base}/functions/v1/detect-terms`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: chunk,
          subject: subject ?? 'general',
          year: year_of_study ?? 1,
          known_terms: [],
        }),
      })
      if (!dtRes.ok) return
      const detected = await dtRes.json()
      for (const t of detected?.terms ?? []) {
        const key = t.term.toLowerCase()
        if (!seen.has(key)) { seen.add(key); allTerms.push(t) }
      }
    }))

    if (allTerms.length) {
      await supabase.from('terms').insert(
        allTerms.map(t => ({
          user_id: user.id,
          session_id: sessionId,
          term: t.term,
          definition: t.definition,
          subject: subject ?? null,
        }))
      )
    }

    // Generate synopsis — truncate transcript to 2000 chars for cost control
    const summaryRes = await fetch(`${base}/functions/v1/summarize-session`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, subject, terms: allTerms }),
    })

    let synopsis: string | null = null
    if (summaryRes.ok) {
      const sd = await summaryRes.json()
      synopsis = sd?.synopsis ?? null
    }

    return new Response(JSON.stringify({ ok: true, session_id: sessionId, term_count: allTerms.length, synopsis }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('process-text-upload error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
