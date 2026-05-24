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
    const { session_id, terms, subject } = await req.json() as {
      session_id: string
      terms: Array<{ term: string; definition: string }>
      subject?: string | null
    }

    if (!session_id || !terms?.length) {
      return new Response(JSON.stringify({ ok: false }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const termList = terms.map(t => `- ${t.term}: ${t.definition}`).join('\n')
    const context = subject ? `for a lecture on "${subject}"` : 'from a lecture'

    const prompt = `You extracted these terms ${context}:\n${termList}\n\nReturn a JSON object with:\n- "name": a 3–5 word title for this session (e.g. "Cell Division Basics", "SQL Joins Overview")\n- "synopsis": a 1–2 sentence summary of what was covered\n\nBe concise and specific to the terms above.`

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

    const data = await response.json()
    const parsed = JSON.parse(data.choices[0].message.content) as { name?: string; synopsis?: string }

    const ai_name = parsed.name?.trim() || null
    const synopsis = parsed.synopsis?.trim() || null

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    await supabase.from('sessions').update({ ai_name, synopsis }).eq('id', session_id)

    return new Response(
      JSON.stringify({ ok: true, ai_name, synopsis }),
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
