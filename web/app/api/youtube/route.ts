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

function parseTimedtextXml(xml: string): CaptionSegment[] {
  const RE = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g
  const segments: CaptionSegment[] = []
  let m: RegExpExecArray | null
  while ((m = RE.exec(xml)) !== null) {
    const text = m[3]
      .replace(/<[^>]+>/g, '')               // strip any nested tags
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/\n/g, ' ').trim()
    if (text) segments.push({ text, offset: Number(m[1]), duration: Number(m[2]) })
  }
  return segments
}

async function fetchCaptionTrack(track: CaptionTrack): Promise<CaptionSegment[]> {
  // Try json3 first; fall back to XML (default format for timedtext API)
  const jsonRes = await fetch(`${track.baseUrl}&fmt=json3`)
  if (jsonRes.ok) {
    const ct = jsonRes.headers.get('content-type') ?? ''
    if (ct.includes('json')) {
      const data = await jsonRes.json() as { events?: TimedtextEvent[] }
      const segs = parseTimedtextEvents(data.events ?? [])
      if (segs.length) return segs
    }
  }
  // XML path (default for most InnerTube caption URLs)
  const xmlRes = await fetch(track.baseUrl)
  if (!xmlRes.ok) throw new Error('caption_track_fetch_failed')
  return parseTimedtextXml(await xmlRes.text())
}

// Calls the Supabase Edge Function which runs on Cloudflare infrastructure.
// Cloudflare IPs are not blocked by YouTube, unlike Vercel's AWS datacenter IPs.
async function fetchYouTubeCaptions(videoId: string): Promise<CaptionSegment[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const res = await fetch(`${supabaseUrl}/functions/v1/youtube-captions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ videoId }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? `edge_fn_${res.status}`)
  }

  const data = await res.json() as { ok?: boolean; segments?: CaptionSegment[] }
  if (!data.segments?.length) throw new Error('no_captions')
  return data.segments
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

  // Fetch transcript — Android InnerTube primary, library fallbacks
  let segments: CaptionSegment[] = []
  let lastError = 'unknown'
  try {
    segments = await fetchYouTubeCaptions(videoId)
    console.log(`[youtube] innertube ok: ${segments.length} segments for ${videoId}`)
  } catch (e1) {
    lastError = `innertube: ${e1 instanceof Error ? e1.message : String(e1)}`
    console.error(`[youtube] ${lastError}`)
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' })
      console.log(`[youtube] library(en) ok: ${segments.length} segments for ${videoId}`)
    } catch (e2) {
      lastError = `library_en: ${e2 instanceof Error ? e2.message : String(e2)}`
      console.error(`[youtube] ${lastError}`)
      try {
        segments = await YoutubeTranscript.fetchTranscript(videoId)
        console.log(`[youtube] library(any) ok: ${segments.length} segments for ${videoId}`)
      } catch (e3) {
        lastError = `library_any: ${e3 instanceof Error ? e3.message : String(e3)}`
        console.error(`[youtube] ${lastError}`)
        return NextResponse.json(
          { error: 'no_captions', message: 'This video has no captions. Try a video with subtitles enabled.', debug: lastError },
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
