import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://demist.app', 'https://www.demist.app', 'http://localhost:3000', 'http://localhost:3001']
const MAX_AUDIO_BYTES = 25 * 1024 * 1024 // 25 MB

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

serve(async (req) => {
  const origin = req.headers.get('origin')
  const CORS = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }

  // Authenticate the caller
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
  const token = authHeader.slice(7)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const contentType = req.headers.get('content-type') ?? 'audio/webm'
    const audioBytes = await req.arrayBuffer()

    if (audioBytes.byteLength < 1000) {
      return new Response(JSON.stringify({ text: '' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (audioBytes.byteLength > MAX_AUDIO_BYTES) {
      return new Response(JSON.stringify({ error: 'audio_too_large' }), {
        status: 413,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Validate MIME type against magic bytes
    const bytes = new Uint8Array(audioBytes.slice(0, 12))
    const isWebm = bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3
    const isMp4 = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
    const isMp3 = (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) || (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)
    const isOgg = bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53

    if (!isWebm && !isMp4 && !isMp3 && !isOgg) {
      return new Response(JSON.stringify({ error: 'invalid_audio_format' }), {
        status: 415,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const ext = isMp4 ? 'mp4' : isMp3 ? 'mp3' : isOgg ? 'ogg' : 'webm'
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
