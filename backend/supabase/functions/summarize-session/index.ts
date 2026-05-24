import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }

  try {
    const { session_id, subject, terms: passedTerms } = await req.json() as {
      session_id: string
      subject?: string | null
      terms?: { term: string; definition: string }[]
    }

    if (!session_id) {
      return new Response(JSON.stringify({ ok: false }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let termRows: { term: string; definition: string }[] = passedTerms ?? []

    if (!termRows.length) {
      const { data } = await supabase
        .from('terms')
        .select('term, definition')
        .eq('session_id', session_id)
        .limit(60)
      termRows = data ?? []
    }

    if (!termRows.length) {
      return new Response(JSON.stringify({ ok: false, reason: 'no terms' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const termList = termRows.map((t: { term: string; definition: string }) => `- ${t.term}: ${t.definition}`).join('\n')
    const context = subject ? `for a lecture on "${subject}"` : 'from a lecture'

    const prompt = `These terms were extracted ${context}:\n${termList}\n\nWrite a 1–2 sentence summary of what this lecture covered. Be specific to the actual terms listed. Return JSON with a single field "synopsis".`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      console.error('OpenAI error:', await response.text())
      return new Response(JSON.stringify({ ok: false }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const aiData = await response.json()
    const parsed = JSON.parse(aiData.choices[0].message.content) as { synopsis?: string }
    const synopsis = parsed.synopsis?.trim() || null

    await supabase.from('sessions').update({ synopsis }).eq('id', session_id)

    return new Response(
      JSON.stringify({ ok: true, synopsis }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    console.error('summarize-session error:', e)
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
