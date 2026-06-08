import { NextRequest, NextResponse } from 'next/server'
import { YoutubeTranscript } from 'youtube-transcript'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const YT_ID_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/

const _rl = new Map<string, number[]>()
function rateLimit(key: string, max: number, windowMs = 3_600_000): boolean {
  const now = Date.now()
  const hits = (_rl.get(key) ?? []).filter(t => now - t < windowMs)
  if (hits.length >= max) return false
  hits.push(now)
  _rl.set(key, hits)
  return true
}

function extractVideoId(url: string): string | null {
  const m = url.match(YT_ID_RE)
  return m?.[1] ?? null
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

type CaptionSegment = { text: string; duration: number; offset: number }

// Direct YouTube caption fetch — parses ytInitialPlayerResponse from the watch page.
// More reliable than youtube-transcript@1.3.1 which breaks with YouTube format changes.
async function fetchYouTubeCaptions(videoId: string): Promise<CaptionSegment[]> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  }

  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers })
  if (!pageRes.ok) throw new Error('page_unavailable')
  const html = await pageRes.text()

  // Find ytInitialPlayerResponse by brace-counting (regex is fragile on 500KB pages)
  const marker = 'ytInitialPlayerResponse='
  const markerIdx = html.indexOf(marker)
  if (markerIdx === -1) throw new Error('no_player_response')

  let depth = 0
  let jsonStart = -1
  let playerResponse: Record<string, unknown> | null = null

  for (let i = markerIdx + marker.length; i < html.length; i++) {
    const ch = html[i]
    if (ch === '{') {
      if (depth === 0) jsonStart = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && jsonStart !== -1) {
        try {
          playerResponse = JSON.parse(html.slice(jsonStart, i + 1)) as Record<string, unknown>
        } catch {
          throw new Error('parse_failed')
        }
        break
      }
    }
  }

  if (!playerResponse) throw new Error('parse_failed')

  type CaptionTrack = { baseUrl: string; languageCode: string }
  const tracks: CaptionTrack[] | undefined =
    (playerResponse as { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } } })
      ?.captions?.playerCaptionsTracklistRenderer?.captionTracks

  if (!tracks?.length) throw new Error('no_captions')

  // Prefer English (manual first, then auto-generated), then first available
  const track =
    tracks.find(t => t.languageCode === 'en') ??
    tracks.find(t => t.languageCode.startsWith('en')) ??
    tracks[0]

  const captionUrl = `${track.baseUrl}&fmt=json3`
  const captRes = await fetch(captionUrl, { headers })
  if (!captRes.ok) throw new Error('caption_fetch_failed')
  const data = await captRes.json() as { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8: string }[] }[] }

  return (data.events ?? [])
    .filter(e => e.segs)
    .map(e => ({
      text: (e.segs ?? []).map(s => s.utf8 ?? '').join('').replace(/\n/g, ' ').trim(),
      offset: e.tStartMs ?? 0,
      duration: e.dDurationMs ?? 0,
    }))
    .filter(s => s.text)
}

export async function GET(req: NextRequest) {
  // Auth check — only signed-in users can use this endpoint
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Rate limit: 20 YouTube imports/hour
  if (!rateLimit(user.id, 20)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '3600' } })
  }

  const url = req.nextUrl.searchParams.get('url')?.trim()
  if (!url || url.length > 200) return NextResponse.json({ error: 'invalid_youtube_url' }, { status: 400 })

  const videoId = extractVideoId(url)
  if (!videoId) {
    return NextResponse.json({ error: 'invalid_youtube_url' }, { status: 400 })
  }

  // Fetch video metadata via oEmbed (no API key needed)
  let title = 'YouTube Video'
  let channel = ''
  let thumbnail = ''
  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { next: { revalidate: 3600 } }
    )
    if (oembedRes.ok) {
      const oembed = await oembedRes.json()
      title = oembed.title ?? title
      channel = oembed.author_name ?? ''
      thumbnail = oembed.thumbnail_url ?? ''
    }
  } catch {
    // oEmbed is best-effort — continue without metadata
  }

  // Fetch transcript — try direct page parsing first, fall back to the library
  let segments: CaptionSegment[] = []
  try {
    segments = await fetchYouTubeCaptions(videoId)
  } catch {
    // Fall back to youtube-transcript library
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' })
    } catch {
      try {
        segments = await YoutubeTranscript.fetchTranscript(videoId)
      } catch {
        return NextResponse.json(
          { error: 'no_captions', message: 'This video has no captions. Try a video with subtitles enabled.' },
          { status: 422 }
        )
      }
    }
  }

  if (!segments.length) {
    return NextResponse.json(
      { error: 'no_captions', message: 'No caption content found for this video.' },
      { status: 422 }
    )
  }

  // Build clean transcript text and estimate duration
  const transcript = segments.map(s => s.text.replace(/\n/g, ' ')).join(' ').replace(/\s+/g, ' ').trim()
  const lastSeg = segments[segments.length - 1]
  const durationSeconds = lastSeg ? Math.round((lastSeg.offset + lastSeg.duration) / 1000) : 0

  return NextResponse.json({
    ok: true,
    video_id: videoId,
    title,
    channel,
    thumbnail,
    duration_seconds: durationSeconds,
    duration_formatted: formatDuration(durationSeconds),
    transcript,
    word_count: transcript.split(/\s+/).length,
  })
}
