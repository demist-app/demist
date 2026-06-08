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

type CaptionTrack = { baseUrl: string; languageCode: string }
type TimedtextEvent = { tStartMs?: number; dDurationMs?: number; segs?: { utf8: string }[] }

function parseTimedtextEvents(events: TimedtextEvent[]): CaptionSegment[] {
  return events
    .filter(e => e.segs)
    .map(e => ({
      text: (e.segs ?? []).map(s => s.utf8 ?? '').join('').replace(/\n/g, ' ').trim(),
      offset: e.tStartMs ?? 0,
      duration: e.dDurationMs ?? 0,
    }))
    .filter(s => s.text)
}

async function fetchCaptionTrack(track: CaptionTrack): Promise<CaptionSegment[]> {
  const res = await fetch(`${track.baseUrl}&fmt=json3`)
  if (!res.ok) throw new Error('caption_track_fetch_failed')
  const data = await res.json() as { events?: TimedtextEvent[] }
  return parseTimedtextEvents(data.events ?? [])
}

// Uses YouTube's InnerTube API — works server-side without cookies or consent handling.
// The TVHTML5_SIMPLY_EMBEDDED_PLAYER client is lightweight and doesn't trigger consent gates.
async function fetchYouTubeCaptions(videoId: string): Promise<CaptionSegment[]> {
  const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
          clientVersion: '2.0',
          hl: 'en',
          gl: 'US',
        },
      },
    }),
  })

  if (!playerRes.ok) throw new Error('innertube_failed')
  const playerData = await playerRes.json() as {
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } }
  }

  const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks
  if (!tracks?.length) throw new Error('no_captions')

  // Prefer English (manual first, then auto-generated en-*, then first available)
  const track =
    tracks.find(t => t.languageCode === 'en') ??
    tracks.find(t => t.languageCode.startsWith('en')) ??
    tracks[0]

  return fetchCaptionTrack(track)
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
