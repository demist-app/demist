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

  // Fetch transcript
  let segments: { text: string; duration: number; offset: number }[] = []
  try {
    segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' })
  } catch {
    // Try without lang preference (catches auto-generated in other language variants)
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId)
    } catch {
      return NextResponse.json(
        { error: 'no_captions', message: 'This video has no captions. Try a video with subtitles enabled.' },
        { status: 422 }
      )
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
