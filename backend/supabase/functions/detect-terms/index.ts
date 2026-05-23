import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }

  try {
    const { transcript, subject, year } = await req.json()

    if (!transcript?.trim()) {
      return new Response(JSON.stringify({ terms: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const prompt = `You are helping a ${year ?? 1} year university student studying ${subject ?? 'general'}.

Read this lecture transcript excerpt and identify terms, acronyms, or concepts that a ${year ?? 1} year ${subject ?? 'general'} student might not yet know.

Transcript: "${transcript}"

Return a JSON object with a "terms" array. Each item must have "term" (string) and "definition" (one clear sentence in plain English) fields. If there are no unfamiliar terms, return {"terms": []}.

Example: {"terms": [{"term": "mitosis", "definition": "The process by which a cell divides into two genetically identical daughter cells."}]}`

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
        temperature: 0.2,
      }),
    })

    if (!response.ok) {
      console.error('OpenAI error:', await response.text())
      return new Response(JSON.stringify({ terms: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const data = await response.json()
    const parsed = JSON.parse(data.choices[0].message.content)

    return new Response(
      JSON.stringify({ terms: Array.isArray(parsed.terms) ? parsed.terms : [] }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    console.error('detect-terms error:', e)
    return new Response(JSON.stringify({ terms: [] }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
