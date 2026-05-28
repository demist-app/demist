import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authErr || !user) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { storage_path, session_name, subject, year_of_study } = await req.json()
    if (!storage_path) {
      return new Response(JSON.stringify({ ok: false, error: 'missing_storage_path' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Download the audio file from Supabase Storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from('recordings')
      .download(storage_path)

    if (dlErr || !fileData) {
      return new Response(JSON.stringify({ ok: false, error: 'download_failed', detail: dlErr?.message }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const ext = storage_path.split('.').pop()?.toLowerCase() ?? 'mp3'
    const mimeMap: Record<string, string> = {
      mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'audio/mp4',
      m4a: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg',
    }
    const mime = mimeMap[ext] ?? 'audio/mpeg'

    // Send to OpenAI Whisper
    const form = new FormData()
    form.append('file', new File([fileData], `audio.${ext}`, { type: mime }))
    form.append('model', 'whisper-1')
    form.append('response_format', 'text')

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    })

    if (!whisperRes.ok) {
      const errText = await whisperRes.text()
      return new Response(JSON.stringify({ ok: false, error: 'whisper_failed', detail: errText }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const transcript = (await whisperRes.text()).trim()
    if (!transcript) {
      return new Response(JSON.stringify({ ok: false, error: 'empty_transcript' }), {
        status: 422, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Create a session record
    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .insert({
        user_id: user.id,
        name: session_name ?? null,
        subject: subject ?? null,
        year_of_study: year_of_study ?? null,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        transcript,
        source: 'audio_upload',
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

    // Detect terms from the full transcript
    const dtRes = await fetch(`${base}/functions/v1/detect-terms`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcript,
        subject: subject ?? 'general',
        year: year_of_study ?? 1,
        known_terms: [],
      }),
    })

    let terms: { term: string; definition: string }[] = []
    if (dtRes.ok) {
      const detected = await dtRes.json()
      terms = detected?.terms ?? []
    }

    if (terms.length) {
      await supabase.from('terms').insert(
        terms.map(t => ({
          user_id: user.id,
          session_id: sessionId,
          term: t.term,
          definition: t.definition,
          subject: subject ?? null,
        }))
      )
    }

    // Generate synopsis
    const summaryRes = await fetch(`${base}/functions/v1/summarize-session`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session_id: sessionId, subject, terms }),
    })

    let synopsis: string | null = null
    if (summaryRes.ok) {
      const sd = await summaryRes.json()
      synopsis = sd?.synopsis ?? null
    }

    return new Response(JSON.stringify({ ok: true, session_id: sessionId, term_count: terms.length, synopsis }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('transcribe-audio error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
