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
    const contentType = req.headers.get('content-type') ?? 'audio/webm'
    const audioBytes = await req.arrayBuffer()

    if (audioBytes.byteLength < 1000) {
      return new Response(JSON.stringify({ text: '' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Determine file extension from MIME type for Whisper
    const ext = contentType.includes('mp4') ? 'mp4'
      : contentType.includes('mpeg') ? 'mp3'
      : 'webm'

    const file = new File([audioBytes], `audio.${ext}`, { type: contentType })

    const form = new FormData()
    form.append('file', file)
    form.append('model', 'whisper-1')
    form.append('response_format', 'json')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
      body: form,
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Whisper error:', err)
      return new Response(JSON.stringify({ text: '' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const data = await response.json()
    return new Response(JSON.stringify({ text: data.text ?? '' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('transcribe error:', e)
    return new Response(JSON.stringify({ text: '' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
