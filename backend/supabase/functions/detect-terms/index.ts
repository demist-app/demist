import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  const { transcript, subject, year } = await req.json()

  const prompt = `You are helping a ${year} year university student studying ${subject}.

Read this lecture transcript excerpt and identify any terms, acronyms, or concepts that a ${year} year ${subject} student might not understand yet.

Transcript: "${transcript}"

Return ONLY a JSON array. Each item should have "term" and "definition" fields. The definition should be one clear sentence in plain English. If there are no unfamiliar terms return an empty array.

Example: [{"term": "mitosis", "definition": "The process by which a cell divides to produce two identical daughter cells."}]`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  })

  const data = await response.json()
  const terms = JSON.parse(data.choices[0].message.content)

  return new Response(JSON.stringify(terms), {
    headers: { 'Content-Type': 'application/json' },
  })
})
