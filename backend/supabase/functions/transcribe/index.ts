import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://demist.app', 'https://www.demist.app', 'http://localhost:3000', 'http://localhost:3001']
const MAX_AUDIO_BYTES = 25 * 1024 * 1024 // 25 MB

// In-memory sliding-window rate limiter.
// Resets on cold start; effective against burst abuse within a warm instance.
const _rl = new Map<string, number[]>()
function rateLimit(key: string, max: number, windowMs = 3_600_000): boolean {
  const now = Date.now()
  const hits = (_rl.get(key) ?? []).filter(t => now - t < windowMs)
  if (hits.length >= max) return false
  hits.push(now)
  _rl.set(key, hits)
  return true
}

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

  // Rate limit: 400 requests/hour (covers ~66-min recording at 10s chunks)
  if (!rateLimit(user.id, 400)) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Retry-After': '3600' },
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

    // Whitelist extensions — never trust Content-Type from the client blindly
    const ext = contentType.includes('mp4') || contentType.includes('m4a') ? 'mp4'
      : contentType.includes('mpeg') || contentType.includes('mp3') ? 'mp3'
      : contentType.includes('ogg') ? 'ogg'
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
