import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.36.3'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { session_id, subject, terms } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: session } = await supabase
      .from('sessions')
      .select('transcript')
      .eq('id', session_id)
      .single()

    const transcript: string | null = session?.transcript ?? null

    let prompt: string
    if (transcript && transcript.length > 80) {
      prompt = `You are summarising a lecture for a student.

Lecture transcript:
${transcript}

Write a comprehensive summary (5-8 sentences) covering ALL the important concepts, key points and ideas discussed. Be specific and educational - a student should be able to read this and understand what the lecture was about. Plain prose only, no bullet points, no markdown.`
    } else if (terms?.length) {
      prompt = `You are summarising a lecture for a student.

Terms detected:
${(terms as { term: string; definition: string }[]).map(t => `- ${t.term}: ${t.definition}`).join('\n')}

Write a brief summary (3-5 sentences) of what was covered based on these terms. Plain prose only, no bullet points, no markdown.`
    } else {
      return new Response(JSON.stringify({ ok: false, error: 'no_content' }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: 'missing_api_key' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    })

    const synopsis = msg.content[0].type === 'text' ? msg.content[0].text.trim() : null
    if (synopsis) {
      await supabase.from('sessions').update({ synopsis }).eq('id', session_id)
    }

    return new Response(JSON.stringify({ ok: !!synopsis, synopsis }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('summarize-session error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
