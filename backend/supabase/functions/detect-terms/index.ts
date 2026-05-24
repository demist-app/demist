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
    const { transcript, subject, year, known_terms } = await req.json()

    if (!transcript?.trim()) {
      return new Response(JSON.stringify({ terms: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const knownList = Array.isArray(known_terms) && known_terms.length
      ? known_terms.slice(0, 80).join(', ')
      : 'none'

    const prompt = `You are a study assistant for a Year ${year ?? 1} ${subject ?? 'general'} student.

Lecture excerpt: "${transcript}"

Terms the student already knows (do NOT flag these): ${knownList}

Task: Identify at most 1–2 subject-specific or technical terms from this excerpt that:
1. This student is UNLIKELY to know given their year and subject
2. Are genuinely LOAD-BEARING — if the student doesn't understand them, the next few minutes of lecture will not make sense
3. Are NOT in the known terms list above

Rules:
- Return 0 terms if the excerpt has no important technical concepts (transitions, filler, generic language)
- Return at most 2 terms — prefer 1 when only one truly matters
- Never flag common English words or terms obvious to any university student
- Definitions must be one clear sentence in plain English

Return JSON: {"terms": [{"term": "...", "definition": "..."}]}`

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
