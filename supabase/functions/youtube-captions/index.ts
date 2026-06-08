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

async function tryInnerTube(videoId: string, clientName: string, clientVersion: string, userAgent: string, extra: Record<string, string> = {}) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent },
    body: JSON.stringify({
      videoId,
      context: { client: { clientName, clientVersion, hl: 'en', gl: 'US', ...extra } },
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks as
    Array<{ baseUrl: string; languageCode: string }> | undefined
  return { playStatus: data?.playabilityStatus?.status as string | undefined, tracks }
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

    // Try multiple InnerTube clients — YouTube returns different data per client/IP
    const attempts = [
      // Android with gl=US (most common working approach)
      () => tryInnerTube(videoId, 'ANDROID', INNERTUBE_VERSION,
        `com.google.android.youtube/${INNERTUBE_VERSION} (Linux; U; Android 14)`),
      // Android Music client — different code path
      () => tryInnerTube(videoId, 'ANDROID_MUSIC', '7.27.52',
        'com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14)'),
      // iOS client
      () => tryInnerTube(videoId, 'IOS', '19.45.4',
        'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
        { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.1.0.22B83' }),
      // TV HTML5 embedded (bypass embedding restrictions attempt)
      () => tryInnerTube(videoId, 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', '2.0',
        'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko)'),
    ]

    let diagInfo = ''
    for (const attempt of attempts) {
      const result = await attempt().catch(() => null)
      if (!result) continue
      if (result.tracks?.length) {
        const track =
          result.tracks.find(t => t.languageCode === 'en') ??
          result.tracks.find(t => t.languageCode.startsWith('en')) ??
          result.tracks[0]
        const xmlRes = await fetch(track.baseUrl)
        if (!xmlRes.ok) continue
        const segments = parseTimedtextXml(await xmlRes.text())
        if (segments.length) {
          return new Response(JSON.stringify({ ok: true, segments, language_code: track.languageCode }), {
            status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
          })
        }
      }
      // Accumulate diagnostic info
      diagInfo += `|${result.playStatus ?? 'noStatus'}:tracks=${result.tracks?.length ?? 0}`
    }

    // Last resort: direct unsigned timedtext URL (works for some videos without auth)
    for (const lang of ['en', 'en-US', '']) {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}${lang ? `&lang=${lang}` : ''}`
      const r = await fetch(url, {
        headers: { 'User-Agent': `com.google.android.youtube/${INNERTUBE_VERSION} (Linux; U; Android 14)` },
      }).catch(() => null)
      if (r?.ok) {
        const xml = await r.text()
        if (xml.includes('<p t=')) {
          const segments = parseTimedtextXml(xml)
          if (segments.length) {
            return new Response(JSON.stringify({ ok: true, segments, language_code: lang || 'unknown', source: 'timedtext_direct' }), {
              status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
            })
          }
        }
      }
    }

    return new Response(JSON.stringify({ error: 'no_captions', diag: diagInfo }), {
      status: 422, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'internal_error', detail: String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
