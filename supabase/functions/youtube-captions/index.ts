import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const INNERTUBE_VERSION = '20.10.38'

interface Segment { text: string; offset: number; duration: number }

function parseTimedtextXml(xml: string): Segment[] {
  const RE = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g
  const segments: Segment[] = []
  let m: RegExpExecArray | null
  while ((m = RE.exec(xml)) !== null) {
    const text = m[3]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/\n/g, ' ').trim()
    if (text) segments.push({ text, offset: Number(m[1]), duration: Number(m[2]) })
  }
  return segments
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const body = await req.json().catch(() => ({}))
    const { videoId } = body
    if (!videoId || typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return new Response(JSON.stringify({ error: 'invalid_video_id' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `com.google.android.youtube/${INNERTUBE_VERSION} (Linux; U; Android 14)`,
      },
      body: JSON.stringify({
        videoId,
        context: { client: { clientName: 'ANDROID', clientVersion: INNERTUBE_VERSION } },
      }),
    })

    if (!playerRes.ok) {
      return new Response(JSON.stringify({ error: 'innertube_failed', http_status: playerRes.status }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const playerData = await playerRes.json()
    const playStatus = playerData?.playabilityStatus?.status

    if (playStatus === 'ERROR' || playStatus === 'UNPLAYABLE') {
      return new Response(JSON.stringify({ error: 'video_unavailable', play_status: playStatus }), {
        status: 422, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks as
      Array<{ baseUrl: string; languageCode: string }> | undefined

    if (!tracks?.length) {
      return new Response(JSON.stringify({ error: 'no_captions' }), {
        status: 422, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const track =
      tracks.find(t => t.languageCode === 'en') ??
      tracks.find(t => t.languageCode.startsWith('en')) ??
      tracks[0]

    const xmlRes = await fetch(track.baseUrl)
    if (!xmlRes.ok) {
      return new Response(JSON.stringify({ error: 'caption_fetch_failed' }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const segments = parseTimedtextXml(await xmlRes.text())
    if (!segments.length) {
      return new Response(JSON.stringify({ error: 'empty_captions' }), {
        status: 422, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true, segments, language_code: track.languageCode }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'internal_error', detail: String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
