'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const FETCH_TIMEOUT_MS = 300_000 // 5 min — long audio files take time

function fetchWithTimeout(url: string, options: RequestInit, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id))
}

const AUDIO_UPLOAD_ERRORS: Record<string, string> = {
  file_too_large: 'File exceeds the 50 MB limit. Try a compressed format like WebM or MP3, or split the recording into parts.',
  unauthorized: 'Your session expired. Please sign in again.',
  storage_download_failed: 'Could not retrieve your file. Please try again.',
  invalid_audio_format: 'File format not recognised. Use MP3, WAV, MP4, M4A, WebM, or OGG.',
  internal_error: 'Processing failed. Please try again.',
}

function friendlyAudioError(code: string): string {
  return AUDIO_UPLOAD_ERRORS[code] ?? `Processing failed: ${code.replace(/_/g, ' ')}.`
}

// ---- Types ----

type AudioStatus = 'idle' | 'uploading' | 'transcribing' | 'processing' | 'done' | 'error'
type TextStatus = 'idle' | 'extracting' | 'processing' | 'done' | 'error'
type YTStatus = 'idle' | 'fetching' | 'ready' | 'importing' | 'done' | 'error'
type NotionPushStatus = 'idle' | 'pushing' | 'done' | 'error'
type NotionPullStatus = 'idle' | 'loading_pages' | 'importing' | 'done' | 'error'

interface YTMeta {
  video_id: string
  title: string
  channel: string
  thumbnail: string
  duration_formatted: string
  transcript: string
  word_count: number
}

interface UploadResult {
  session_id: string
  term_count: number
  synopsis: string | null
}

interface NotionPage {
  id: string
  title: string
}

interface NotionIntegration {
  workspace_name: string | null
}

// ---- File parsing ----

async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase()

  if (ext === 'txt') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file)
    })
  }

  if (ext === 'pptx' || ext === 'docx') {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(file)
    const texts: string[] = []

    if (ext === 'pptx') {
      const slideFiles = Object.keys(zip.files)
        .filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
        .sort()

      for (const name of slideFiles) {
        const xml = await zip.files[name].async('string')
        const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) ?? []
        const slideText = matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ')
        if (slideText.trim()) texts.push(slideText)
      }
    } else {
      const docXml = await zip.files['word/document.xml']?.async('string')
      if (docXml) {
        const matches = docXml.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) ?? []
        texts.push(matches.map(m => m.replace(/<[^>]+>/g, '')).join(' '))
      }
    }

    return texts.join('\n\n')
  }

  throw new Error(`Unsupported file type: .${ext}`)
}

// ---- Main page ----

export default function ImportPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<{ course: string | null; year_of_study: number | null } | null>(null)
  const [notionIntegration, setNotionIntegration] = useState<NotionIntegration | null>(null)
  const [notionConnectMsg, setNotionConnectMsg] = useState<string | null>(null)

  // YouTube import state
  const [ytUrl, setYtUrl] = useState('')
  const [ytStatus, setYtStatus] = useState<YTStatus>('idle')
  const [ytMeta, setYtMeta] = useState<YTMeta | null>(null)
  const [ytResult, setYtResult] = useState<UploadResult | null>(null)
  const [ytError, setYtError] = useState<string | null>(null)
  const [ytProgress, setYtProgress] = useState(0)
  const [ytRedirect, setYtRedirect] = useState<number | null>(null)

  // Audio upload state
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [audioStatus, setAudioStatus] = useState<AudioStatus>('idle')
  const [audioResult, setAudioResult] = useState<UploadResult | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [audioProgress, setAudioProgress] = useState(0)
  const [audioRedirect, setAudioRedirect] = useState<number | null>(null)
  const audioDragRef = useRef(false)
  const [audioDragOver, setAudioDragOver] = useState(false)

  // Text upload state
  const [textFile, setTextFile] = useState<File | null>(null)
  const [textStatus, setTextStatus] = useState<TextStatus>('idle')
  const [textResult, setTextResult] = useState<UploadResult | null>(null)
  const [textError, setTextError] = useState<string | null>(null)
  const [textProgress, setTextProgress] = useState(0)
  const [textRedirect, setTextRedirect] = useState<number | null>(null)
  const textDragRef = useRef(false)
  const [textDragOver, setTextDragOver] = useState(false)

  // Notion push state
  const [glossaryPushStatus, setGlossaryPushStatus] = useState<NotionPushStatus>('idle')
  const [summaryPushStatus, setSummaryPushStatus] = useState<NotionPushStatus>('idle')
  const [glossaryPageUrl, setGlossaryPageUrl] = useState<string | null>(null)
  const [summaryPageUrl, setSummaryPageUrl] = useState<string | null>(null)

  // Notion pull state
  const [notionPages, setNotionPages] = useState<NotionPage[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string>('')
  const [notionPullStatus, setNotionPullStatus] = useState<NotionPullStatus>('idle')
  const [notionPullResult, setNotionPullResult] = useState<UploadResult | null>(null)
  const [notionPullError, setNotionPullError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user
      if (!user) { router.replace('/login'); return }
      setUserId(user.id)

      const [{ data: prof }, { data: integration }] = await Promise.all([
        supabase.from('profiles').select('course, year_of_study').eq('id', user.id).maybeSingle(),
        supabase.from('integrations').select('workspace_name').eq('user_id', user.id).eq('provider', 'notion').maybeSingle(),
      ])
      setProfile(prof)
      setNotionIntegration(integration)
    })
  }, [])

  useEffect(() => {
    const connected = searchParams.get('notion_connected')
    const error = searchParams.get('notion_error')
    if (connected === '1') {
      setNotionConnectMsg('Notion connected successfully.')
      const supabase = createClient()
      supabase.from('integrations').select('workspace_name').eq('provider', 'notion').maybeSingle()
        .then(({ data }) => setNotionIntegration(data))
    } else if (error) {
      const NOTION_ERRORS: Record<string, string> = {
        no_code: 'No authorisation code received from Notion.',
        invalid_state: 'Connection attempt expired or was tampered with. Please try again.',
        token_exchange_failed: 'Could not complete the connection. Please try again.',
        access_denied: 'Access was denied. Please grant permission in Notion.',
      }
      const msg = NOTION_ERRORS[error] ?? `Connection failed: ${error.replace(/_/g, ' ')}.`
      setNotionConnectMsg(msg)
    }
  }, [searchParams])

  // ---- Progress bars ----

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    if (audioStatus === 'uploading') {
      setAudioProgress(0)
      interval = setInterval(() => setAudioProgress(p => Math.min(p + 8, 18)), 150)
    } else if (audioStatus === 'transcribing') {
      interval = setInterval(() => setAudioProgress(p => Math.min(p + 0.4, 75)), 400)
    } else if (audioStatus === 'processing') {
      interval = setInterval(() => setAudioProgress(p => Math.min(p + 0.25, 93)), 400)
    } else if (audioStatus === 'done') {
      setAudioProgress(100)
    } else if (audioStatus === 'idle' || audioStatus === 'error') {
      setAudioProgress(0)
    }
    return () => { if (interval) clearInterval(interval) }
  }, [audioStatus])

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    if (textStatus === 'extracting') {
      setTextProgress(0)
      interval = setInterval(() => setTextProgress(p => Math.min(p + 10, 25)), 100)
    } else if (textStatus === 'processing') {
      interval = setInterval(() => setTextProgress(p => Math.min(p + 0.5, 93)), 400)
    } else if (textStatus === 'done') {
      setTextProgress(100)
    } else if (textStatus === 'idle' || textStatus === 'error') {
      setTextProgress(0)
    }
    return () => { if (interval) clearInterval(interval) }
  }, [textStatus])

  // ---- Auto-redirect after success ----

  useEffect(() => {
    if (audioStatus !== 'done') return
    setAudioRedirect(3)
    const interval = setInterval(() => {
      setAudioRedirect(c => {
        if (c === null || c <= 1) { clearInterval(interval); router.push('/history'); return null }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [audioStatus])

  useEffect(() => {
    if (textStatus !== 'done') return
    setTextRedirect(3)
    const interval = setInterval(() => {
      setTextRedirect(c => {
        if (c === null || c <= 1) { clearInterval(interval); router.push('/history'); return null }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [textStatus])

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    if (ytStatus === 'fetching') {
      setYtProgress(0)
      interval = setInterval(() => setYtProgress(p => Math.min(p + 12, 85)), 150)
    } else if (ytStatus === 'importing') {
      interval = setInterval(() => setYtProgress(p => Math.min(p + 0.4, 93)), 400)
    } else if (ytStatus === 'done') {
      setYtProgress(100)
    } else if (ytStatus === 'idle' || ytStatus === 'error' || ytStatus === 'ready') {
      setYtProgress(0)
    }
    return () => { if (interval) clearInterval(interval) }
  }, [ytStatus])

  useEffect(() => {
    if (ytStatus !== 'done') return
    setYtRedirect(3)
    const interval = setInterval(() => {
      setYtRedirect(c => {
        if (c === null || c <= 1) { clearInterval(interval); router.push('/history'); return null }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [ytStatus])

  // ---- Audio upload ----

  const handleAudioUpload = async () => {
    if (!audioFile || !userId) return

    const ALLOWED_AUDIO = /\.(mp3|wav|mp4|m4a|webm|ogg)$/i
    if (!ALLOWED_AUDIO.test(audioFile.name)) {
      setAudioError('Unsupported file type. Use MP3, WAV, MP4, M4A, WebM, or OGG.')
      return
    }
    if (audioFile.size > 50 * 1024 * 1024) {
      setAudioError('File is too large. Maximum size is 50 MB. Try a compressed format like WebM or MP3.')
      return
    }

    setAudioStatus('uploading')
    setAudioError(null)
    setAudioResult(null)

    try {
      const supabase = createClient()
      const ext = audioFile.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'mp3'
      const storagePath = `${userId}/${Date.now()}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('recordings')
        .upload(storagePath, audioFile, { contentType: audioFile.type })

      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

      setAudioStatus('transcribing')

      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL!

      if (!token) throw new Error('Not authenticated')

      const res = await fetchWithTimeout(`${base}/functions/v1/transcribe-audio`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          storage_path: storagePath,
          session_name: audioFile.name.replace(/\.[^.]+$/, '').slice(0, 100),
          subject: profile?.course?.slice(0, 100) ?? null,
          year_of_study: profile?.year_of_study ?? null,
        }),
      })

      setAudioStatus('processing')
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(friendlyAudioError(data.error ?? 'internal_error'))

      setAudioResult(data)
      setAudioStatus('done')
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Something went wrong')
      setAudioStatus('error')
    }
  }

  // ---- YouTube import ----

  const handleYouTubeFetch = async () => {
    if (!ytUrl.trim()) return
    setYtStatus('fetching')
    setYtError(null)
    setYtMeta(null)
    try {
      const res = await fetchWithTimeout(`/api/youtube?url=${encodeURIComponent(ytUrl)}`, {}, 30_000)
      const data = await res.json()
      if (!res.ok) {
        const msgs: Record<string, string> = {
          invalid_youtube_url: 'That doesn\'t look like a valid YouTube URL.',
          no_captions: data.message ?? 'This video has no captions. Try a video with subtitles enabled.',
          unauthorized: 'Your session expired. Please sign in again.',
        }
        throw new Error(msgs[data.error] ?? 'Failed to fetch video. Please try again.')
      }
      setYtMeta(data)
      setYtStatus('ready')
    } catch (err) {
      setYtError(err instanceof Error ? err.message : 'Something went wrong.')
      setYtStatus('error')
    }
  }

  const handleYouTubeImport = async () => {
    if (!ytMeta) return
    setYtStatus('importing')
    setYtError(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL!
      if (!token) throw new Error('Not authenticated')

      const res = await fetchWithTimeout(`${base}/functions/v1/process-text-upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ytMeta.transcript,
          session_name: ytMeta.title.slice(0, 100),
          subject: profile?.course ?? null,
          year_of_study: profile?.year_of_study ?? null,
          source: 'youtube_import',
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Processing failed')
      setYtResult(data)
      setYtStatus('done')
    } catch (err) {
      setYtError(err instanceof Error ? err.message : 'Something went wrong.')
      setYtStatus('error')
    }
  }

  // ---- Text/PPTX upload ----

  const handleTextUpload = async () => {
    if (!textFile || !userId) return

    const ALLOWED_TEXT = /\.(pptx|docx|txt)$/i
    if (!ALLOWED_TEXT.test(textFile.name)) {
      setTextError('Unsupported file type. Use PPTX, DOCX, or TXT.')
      return
    }
    if (textFile.size > 50 * 1024 * 1024) {
      setTextError('File is too large. Maximum size is 50 MB.')
      return
    }

    setTextStatus('extracting')
    setTextError(null)
    setTextResult(null)

    try {
      const text = await extractTextFromFile(textFile)
      if (!text.trim()) throw new Error('No readable text found in this file')

      setTextStatus('processing')

      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL!

      const ext = textFile.name.split('.').pop()?.toLowerCase()
      const sourceMap: Record<string, string> = { pptx: 'pptx_upload', docx: 'docx_upload', txt: 'transcript_upload' }

      if (!token) throw new Error('Not authenticated')

      const res = await fetchWithTimeout(`${base}/functions/v1/process-text-upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          session_name: textFile.name.replace(/\.[^.]+$/, '').slice(0, 100),
          subject: profile?.course?.slice(0, 100) ?? null,
          year_of_study: profile?.year_of_study ?? null,
          source: sourceMap[ext ?? ''] ?? 'text_upload',
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Processing failed')

      setTextResult(data)
      setTextStatus('done')
    } catch (err) {
      setTextError(err instanceof Error ? err.message : 'Something went wrong')
      setTextStatus('error')
    }
  }

  // ---- Notion push ----

  const handleNotionPush = async (type: 'glossary' | 'summaries') => {
    const setStatus = type === 'glossary' ? setGlossaryPushStatus : setSummaryPushStatus
    const setUrl = type === 'glossary' ? setGlossaryPageUrl : setSummaryPageUrl
    setStatus('pushing')
    try {
      const res = await fetchWithTimeout('/api/notion/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: type === 'glossary' ? 'push_glossary' : 'push_summaries' }),
      }, 60_000)
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Push failed')
      if (data.page_url) setUrl(data.page_url)
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }

  // ---- Notion pull ----

  const loadNotionPages = async () => {
    setNotionPullStatus('loading_pages')
    setNotionPullError(null)
    try {
      const res = await fetchWithTimeout('/api/notion/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_pages' }),
      }, 30_000)
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Failed to load pages')
      setNotionPages(data.pages ?? [])
      if (data.pages?.length) setSelectedPageId(data.pages[0].id)
      setNotionPullStatus('idle')
    } catch (err) {
      setNotionPullError(err instanceof Error ? err.message : 'Failed to load pages')
      setNotionPullStatus('error')
    }
  }

  const handleNotionImport = async () => {
    if (!selectedPageId) return
    setNotionPullStatus('importing')
    setNotionPullError(null)
    setNotionPullResult(null)
    try {
      // Pull text from Notion
      const pullRes = await fetch('/api/notion/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull_page', page_id: selectedPageId }),
      })
      const pullData = await pullRes.json()
      if (!pullRes.ok || !pullData.ok) throw new Error(pullData.error ?? 'Failed to fetch page')

      // Process via edge function
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL!

      const pageName = notionPages.find(p => p.id === selectedPageId)?.title ?? 'Notion Import'

      const processRes = await fetch(`${base}/functions/v1/process-text-upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: pullData.text,
          session_name: pageName,
          subject: profile?.course ?? null,
          year_of_study: profile?.year_of_study ?? null,
          source: 'notion_import',
        }),
      })
      const processData = await processRes.json()
      if (!processRes.ok || !processData.ok) throw new Error(processData.error ?? 'Processing failed')

      setNotionPullResult(processData)
      setNotionPullStatus('done')
    } catch (err) {
      setNotionPullError(err instanceof Error ? err.message : 'Something went wrong')
      setNotionPullStatus('error')
    }
  }

  const handleDisconnectNotion = async () => {
    await fetch('/api/notion/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disconnect' }),
    })
    setNotionIntegration(null)
    setNotionConnectMsg(null)
    setNotionPages([])
    setSelectedPageId('')
    setGlossaryPushStatus('idle')
    setSummaryPushStatus('idle')
    setNotionPullStatus('idle')
  }

  // ---- Drag handlers ----

  const makeDropHandlers = (
    accept: RegExp,
    setFile: (f: File | null) => void,
    dragRef: React.MutableRefObject<boolean>,
    setOver: (v: boolean) => void,
    resetStatus: () => void,
  ) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (!dragRef.current) { dragRef.current = true; setOver(true) } },
    onDragLeave: () => { dragRef.current = false; setOver(false) },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); dragRef.current = false; setOver(false)
      const file = e.dataTransfer.files[0]
      if (file && accept.test(file.name)) { setFile(file); resetStatus() }
    },
  })

  const audioDropHandlers = makeDropHandlers(
    /\.(mp3|wav|mp4|m4a|webm|ogg)$/i,
    setAudioFile,
    audioDragRef,
    setAudioDragOver,
    () => { setAudioStatus('idle'); setAudioError(null); setAudioResult(null) },
  )
  const textDropHandlers = makeDropHandlers(
    /\.(pptx|docx|txt)$/i,
    setTextFile,
    textDragRef,
    setTextDragOver,
    () => { setTextStatus('idle'); setTextError(null); setTextResult(null) },
  )

  const audioLabel: Record<AudioStatus, string> = {
    idle: 'Upload Recording',
    uploading: 'Uploading...',
    transcribing: audioFile && audioFile.size > 20 * 1024 * 1024
      ? 'Transcribing in segments — this may take a few minutes...'
      : 'Transcribing...',
    processing: 'Detecting terms...',
    done: 'Done',
    error: 'Try again',
  }
  const textLabel: Record<TextStatus, string> = {
    idle: 'Process File',
    extracting: 'Extracting text...',
    processing: 'Detecting terms...',
    done: 'Done',
    error: 'Try again',
  }

  const audioWorking = ['uploading', 'transcribing', 'processing'].includes(audioStatus)
  const textWorking = ['extracting', 'processing'].includes(textStatus)

  return (
    <div className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] pb-20 sm:pb-10">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-yellow-700/[0.05] blur-[120px]" />
      </div>
      <div className="relative z-10 w-full max-w-2xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">

        {/* Header */}
        <div className="mb-8 animate-step opacity-0" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
          <h1 className="text-2xl font-bold tracking-tight dark:text-white text-gray-900">Import</h1>
          <p className="mt-1 text-sm text-gray-700">Upload recordings, slides, or sync with Notion to build your glossary.</p>
        </div>

        {/* Section 0: YouTube */}
        <section className="mb-5 animate-step opacity-0" style={{ animationDelay: '60ms', animationFillMode: 'forwards' }}>
          <div className="rounded-2xl dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.16] overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center gap-3 mb-1">
                <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-red-500/[0.12] text-red-400">
                  <YouTubeIcon />
                </span>
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold dark:text-white text-gray-900">YouTube Lecture</h2>
                  <span className="text-[10px] font-bold tracking-[0.1em] dark:text-yellow-400 text-yellow-700 bg-yellow-600/15 border border-yellow-500/25 rounded-full px-2 py-0.5 uppercase">New</span>
                </div>
              </div>
              <p className="text-xs text-gray-700 mt-1 ml-11">Paste any YouTube lecture URL. Demist reads the captions and detects unfamiliar terms — no recording needed.</p>
            </div>

            <div className="px-5 pb-2">
              <div className="flex gap-2">
                <input
                  type="url"
                  value={ytUrl}
                  onChange={e => { setYtUrl(e.target.value); if (ytStatus === 'error' || ytStatus === 'ready') { setYtStatus('idle'); setYtMeta(null); setYtError(null) } }}
                  onKeyDown={e => e.key === 'Enter' && ytUrl.trim() && ytStatus === 'idle' && handleYouTubeFetch()}
                  placeholder="https://youtube.com/watch?v=..."
                  className="flex-1 dark:bg-white/[0.04] bg-[#FAF9F6] border dark:border-white/[0.08] border-black/[0.13] rounded-xl px-3 py-2.5 text-[13px] dark:text-white text-gray-900 placeholder-gray-600 focus:outline-none focus:border-yellow-500/40 transition-colors"
                />
                <button
                  onClick={handleYouTubeFetch}
                  disabled={!ytUrl.trim() || ytStatus === 'fetching' || ytStatus === 'importing'}
                  className="px-4 py-2.5 rounded-xl dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] text-[13px] font-medium text-gray-300 hover:dark:bg-white/[0.08] bg-[#EFEDE7] disabled:opacity-40 transition-colors shrink-0"
                >
                  {ytStatus === 'fetching' ? <span className="flex items-center gap-1.5"><SpinnerIcon />Fetching...</span> : 'Fetch'}
                </button>
              </div>
            </div>

            {/* Video preview once fetched */}
            {ytMeta && ytStatus !== 'idle' && ytStatus !== 'fetching' && (
              <div className="mx-5 mb-3 dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-xl p-3 flex items-start gap-3">
                {ytMeta.thumbnail && (
                  <img src={ytMeta.thumbnail} alt="" className="w-20 h-14 object-cover rounded-lg shrink-0 dark:bg-white/[0.05] bg-[#F6F5F2]" />
                )}
                <div className="min-w-0">
                  <p className="text-[13px] font-medium dark:text-white text-gray-900 truncate">{ytMeta.title}</p>
                  <p className="text-[11px] text-gray-700 mt-0.5">{ytMeta.channel} · {ytMeta.duration_formatted}</p>
                  <p className="text-[11px] text-gray-600 mt-0.5">~{ytMeta.word_count.toLocaleString()} words</p>
                </div>
              </div>
            )}

            {/* Progress bar during import */}
            {(ytStatus === 'fetching' || ytStatus === 'importing') && (
              <div className="mx-5 mb-3">
                <div className="h-1 rounded-full dark:bg-white/[0.06] bg-[#F3F1EC] overflow-hidden">
                  <div className="h-full rounded-full bg-red-500 transition-all duration-500 ease-out" style={{ width: `${ytProgress}%` }} />
                </div>
                <p className="text-[11px] text-gray-600 mt-1.5" aria-live="polite">
                  {ytStatus === 'fetching' ? 'Fetching captions...' : 'Detecting terms...'}
                </p>
              </div>
            )}

            {/* Success state */}
            {ytStatus === 'done' && ytResult && (
              <div className="mx-5 mb-5 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircleIcon />
                  <span className="text-sm font-medium">Imported successfully</span>
                </div>
                <p className="text-xs text-gray-600">
                  {ytResult.term_count} term{ytResult.term_count !== 1 ? 's' : ''} detected.
                  {ytResult.synopsis ? ' AI summary generated.' : ''}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <button onClick={() => router.push('/history')} className="text-xs font-medium dark:text-yellow-400 text-yellow-700 hover:dark:text-yellow-300 text-yellow-700 transition-colors active:scale-[0.97]">View in History</button>
                    <span className="text-gray-700">·</span>
                    <button onClick={() => { setYtRedirect(null); setYtUrl(''); setYtStatus('idle'); setYtMeta(null); setYtResult(null) }} className="text-xs text-gray-700 hover:text-gray-600 transition-colors active:scale-[0.97]">Import another</button>
                  </div>
                  {ytRedirect !== null && <span className="text-xs text-gray-600">Redirecting in {ytRedirect}s</span>}
                </div>
              </div>
            )}

            {ytError && <p className="mx-5 mb-4 text-xs text-red-400" role="alert">{ytError}</p>}

            {/* Import button — shown once video is fetched */}
            {ytMeta && (ytStatus === 'ready' || ytStatus === 'error') && (
              <div className="px-5 pb-5">
                <button
                  onClick={handleYouTubeImport}
                  className="w-full h-10 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-500 dark:text-white text-gray-900 transition-colors active:scale-[0.97]"
                >
                  Import this lecture
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Section 1: Audio */}
        <section className="mb-5 animate-step opacity-0" style={{ animationDelay: '90ms', animationFillMode: 'forwards' }}>
          <div className="rounded-2xl dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.16] overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center gap-3 mb-1">
                <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-yellow-500/[0.12] dark:text-yellow-400 text-yellow-700">
                  <MicIcon />
                </span>
                <h2 className="text-[15px] font-semibold dark:text-white text-gray-900">Lecture Recording</h2>
              </div>
              <p className="text-xs text-gray-700 mt-1 ml-11">MP3, WAV, MP4, M4A, WebM, OGG — up to 50 MB. At typical browser recording quality (WebM/opus) that covers roughly 2–3 hours. Large files are transcribed in segments automatically.</p>
            </div>

            <div
              {...audioDropHandlers}
              className={`mx-5 mb-5 rounded-xl border-2 border-dashed transition-colors duration-150 ${
                audioDragOver ? 'border-yellow-500/50 bg-yellow-500/[0.05]' : 'dark:border-white/[0.08] border-black/[0.13] bg-white/[0.02]'
              } ${audioFile ? '' : 'cursor-pointer'}`}
              onClick={() => { if (!audioFile) document.getElementById('audio-input')?.click() }}
            >
              <input
                id="audio-input"
                type="file"
                accept=".mp3,.wav,.mp4,.m4a,.webm,.ogg"
                className="sr-only"
                onChange={e => {
                  const f = e.target.files?.[0] ?? null
                  setAudioFile(f)
                  setAudioStatus('idle')
                  setAudioError(null)
                  setAudioResult(null)
                }}
              />

              {audioStatus === 'done' && audioResult ? (
                <div className="p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <CheckCircleIcon />
                    <span className="text-sm font-medium">Imported successfully</span>
                  </div>
                  <p className="text-xs text-gray-600">
                    {audioResult.term_count} term{audioResult.term_count !== 1 ? 's' : ''} detected.
                    {audioResult.synopsis ? ' AI summary generated.' : ''}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        onClick={() => router.push('/history')}
                        className="text-xs font-medium dark:text-yellow-400 text-yellow-700 hover:dark:text-yellow-300 text-yellow-700 transition-colors duration-150 active:scale-[0.97]"
                      >
                        View in History
                      </button>
                      <span className="text-gray-700">·</span>
                      <button
                        onClick={() => { setAudioRedirect(null); setAudioFile(null); setAudioStatus('idle'); setAudioResult(null) }}
                        className="text-xs text-gray-700 hover:text-gray-600 transition-colors duration-150 active:scale-[0.97]"
                      >
                        Upload another
                      </button>
                    </div>
                    {audioRedirect !== null && (
                      <span className="text-xs text-gray-600">Redirecting in {audioRedirect}s</span>
                    )}
                  </div>
                </div>
              ) : audioFile ? (
                <div className="p-5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex-shrink-0 dark:text-yellow-400 text-yellow-700"><AudioFileIcon /></span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium dark:text-white text-gray-900 truncate">{audioFile.name}</p>
                      <p className="text-xs text-gray-700">
                    {(audioFile.size / 1024 / 1024).toFixed(1)} MB
                    {audioFile.size > 20 * 1024 * 1024 && (
                      <span className="ml-1.5 text-amber-500/70">· will be split into segments</span>
                    )}
                  </p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setAudioFile(null); setAudioStatus('idle'); setAudioError(null) }}
                    className="flex-shrink-0 text-gray-600 hover:text-gray-600 transition-colors duration-150 active:scale-[0.97]"
                  >
                    <CloseIcon />
                  </button>
                </div>
              ) : (
                <div className="p-8 flex flex-col items-center gap-2 text-center">
                  <span className="text-gray-600"><UploadIcon /></span>
                  <p className="text-sm text-gray-700">Drag a recording here or <span className="dark:text-yellow-400 text-yellow-700">browse</span></p>
                  <p className="text-xs text-gray-600">MP3, WAV, MP4, M4A, WebM, OGG · up to 50 MB</p>
                </div>
              )}
            </div>

            {audioWorking && (
              <div className="mx-5 mb-3">
                <div className="h-1 rounded-full dark:bg-white/[0.06] bg-[#F3F1EC] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-yellow-500 transition-all duration-500 ease-out"
                    style={{ width: `${audioProgress}%` }}
                  />
                </div>
                <p className="text-[11px] text-gray-600 mt-1.5" aria-live="polite">{audioLabel[audioStatus]}</p>
              </div>
            )}

            {audioError && (
              <p className="mx-5 mb-4 text-xs text-red-400" role="alert">{audioError}</p>
            )}

            {audioFile && audioStatus !== 'done' && (
              <div className="px-5 pb-5">
                <button
                  onClick={handleAudioUpload}
                  disabled={audioWorking}
                  className={`w-full h-10 rounded-xl text-sm font-semibold transition-colors duration-150 active:scale-[0.97] ${
                    audioWorking
                      ? 'bg-yellow-500/30 dark:text-yellow-300 text-yellow-700 cursor-not-allowed'
                      : 'bg-yellow-600 hover:bg-yellow-500 dark:text-white text-gray-900'
                  }`}
                >
                  {audioWorking ? (
                    <span className="flex items-center justify-center gap-2">
                      <SpinnerIcon />
                      {audioLabel[audioStatus]}
                    </span>
                  ) : audioLabel[audioStatus]}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Section 2: PPTX / Transcript */}
        <section className="mb-5 animate-step opacity-0" style={{ animationDelay: '150ms', animationFillMode: 'forwards' }}>
          <div className="rounded-2xl dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.16] overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center gap-3 mb-1">
                <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-yellow-500/[0.12] dark:text-yellow-400 text-yellow-700">
                  <SlidesIcon />
                </span>
                <h2 className="text-[15px] font-semibold dark:text-white text-gray-900">Slides or Transcript</h2>
              </div>
              <p className="text-xs text-gray-700 mt-1 ml-11">PPTX, DOCX, or TXT. Text is extracted locally then processed for terms.</p>
            </div>

            <div
              {...textDropHandlers}
              className={`mx-5 mb-5 rounded-xl border-2 border-dashed transition-colors duration-150 ${
                textDragOver ? 'border-yellow-500/50 bg-yellow-500/[0.05]' : 'dark:border-white/[0.08] border-black/[0.13] bg-white/[0.02]'
              } ${textFile ? '' : 'cursor-pointer'}`}
              onClick={() => { if (!textFile) document.getElementById('text-input')?.click() }}
            >
              <input
                id="text-input"
                type="file"
                accept=".pptx,.docx,.txt"
                className="sr-only"
                onChange={e => {
                  const f = e.target.files?.[0] ?? null
                  setTextFile(f)
                  setTextStatus('idle')
                  setTextError(null)
                  setTextResult(null)
                }}
              />

              {textStatus === 'done' && textResult ? (
                <div className="p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <CheckCircleIcon />
                    <span className="text-sm font-medium">Imported successfully</span>
                  </div>
                  <p className="text-xs text-gray-600">
                    {textResult.term_count} term{textResult.term_count !== 1 ? 's' : ''} detected.
                    {textResult.synopsis ? ' AI summary generated.' : ''}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        onClick={() => router.push('/history')}
                        className="text-xs font-medium dark:text-yellow-400 text-yellow-700 hover:dark:text-yellow-300 text-yellow-700 transition-colors duration-150 active:scale-[0.97]"
                      >
                        View in History
                      </button>
                      <span className="text-gray-700">·</span>
                      <button
                        onClick={() => { setTextRedirect(null); setTextFile(null); setTextStatus('idle'); setTextResult(null) }}
                        className="text-xs text-gray-700 hover:text-gray-600 transition-colors duration-150 active:scale-[0.97]"
                      >
                        Upload another
                      </button>
                    </div>
                    {textRedirect !== null && (
                      <span className="text-xs text-gray-600">Redirecting in {textRedirect}s</span>
                    )}
                  </div>
                </div>
              ) : textFile ? (
                <div className="p-5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex-shrink-0 dark:text-yellow-400 text-yellow-700"><DocFileIcon /></span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium dark:text-white text-gray-900 truncate">{textFile.name}</p>
                      <p className="text-xs text-gray-700">{(textFile.size / 1024).toFixed(0)} KB</p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setTextFile(null); setTextStatus('idle'); setTextError(null) }}
                    className="flex-shrink-0 text-gray-600 hover:text-gray-600 transition-colors duration-150 active:scale-[0.97]"
                  >
                    <CloseIcon />
                  </button>
                </div>
              ) : (
                <div className="p-8 flex flex-col items-center gap-2 text-center">
                  <span className="text-gray-600"><UploadIcon /></span>
                  <p className="text-sm text-gray-700">Drag a file here or <span className="dark:text-yellow-400 text-yellow-700">browse</span></p>
                  <p className="text-xs text-gray-600">PPTX, DOCX, TXT</p>
                </div>
              )}
            </div>

            {textWorking && (
              <div className="mx-5 mb-3">
                <div className="h-1 rounded-full dark:bg-white/[0.06] bg-[#F3F1EC] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-yellow-500 transition-all duration-500 ease-out"
                    style={{ width: `${textProgress}%` }}
                  />
                </div>
                <p className="text-[11px] text-gray-600 mt-1.5" aria-live="polite">{textLabel[textStatus]}</p>
              </div>
            )}

            {textError && (
              <p className="mx-5 mb-4 text-xs text-red-400" role="alert">{textError}</p>
            )}

            {textFile && textStatus !== 'done' && (
              <div className="px-5 pb-5">
                <button
                  onClick={handleTextUpload}
                  disabled={textWorking}
                  className={`w-full h-10 rounded-xl text-sm font-semibold transition-colors duration-150 active:scale-[0.97] ${
                    textWorking
                      ? 'bg-yellow-500/30 dark:text-yellow-300 text-yellow-700 cursor-not-allowed'
                      : 'bg-yellow-600 hover:bg-yellow-500 dark:text-white text-gray-900'
                  }`}
                >
                  {textWorking ? (
                    <span className="flex items-center justify-center gap-2">
                      <SpinnerIcon />
                      {textLabel[textStatus]}
                    </span>
                  ) : textLabel[textStatus]}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Section 3: Notion Sync */}
        <section className="animate-step opacity-0" style={{ animationDelay: '210ms', animationFillMode: 'forwards' }}>
          <div className="rounded-2xl dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.16] overflow-hidden">
            <div className="px-5 pt-5 pb-5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-3">
                  <span className="flex items-center justify-center w-8 h-8 rounded-xl dark:bg-white/[0.06] bg-[#F3F1EC]">
                    <NotionIcon />
                  </span>
                  <h2 className="text-[15px] font-semibold dark:text-white text-gray-900">Notion</h2>
                </div>
                {notionIntegration && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/[0.1] px-2.5 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                    Connected
                  </span>
                )}
              </div>

              {notionIntegration && (
                <p className="text-xs text-gray-700 ml-11 mb-5">
                  {notionIntegration.workspace_name ? `Workspace: ${notionIntegration.workspace_name}` : 'Connected'}
                </p>
              )}

              {!notionIntegration && (
                <p className="text-xs text-gray-700 mt-1 ml-11 mb-5">
                  Connect to export your glossary and summaries, or import notes from a Notion page.
                </p>
              )}

              {notionConnectMsg && (
                <p className={`text-xs mb-4 ${notionConnectMsg.includes('failed') ? 'text-red-400' : 'text-emerald-400'}`}>
                  {notionConnectMsg}
                </p>
              )}

              {!notionIntegration ? (
                <a
                  href="/api/notion"
                  className="flex items-center justify-center gap-2 w-full h-10 rounded-xl dark:bg-white/[0.05] bg-[#F6F5F2] hover:dark:bg-white/[0.08] bg-[#EFEDE7] border dark:border-white/[0.08] border-black/[0.13] text-sm font-medium dark:text-white text-gray-900 transition-colors duration-150 active:scale-[0.97]"
                >
                  <NotionIcon />
                  Connect Notion
                </a>
              ) : (
                <div className="flex flex-col gap-3">
                  {/* Push section */}
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">Export to Notion</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={() => handleNotionPush('glossary')}
                      disabled={glossaryPushStatus === 'pushing'}
                      className={`flex-1 h-9 rounded-xl text-xs font-semibold border transition-colors duration-150 active:scale-[0.97] ${
                        glossaryPushStatus === 'done'
                          ? 'bg-emerald-500/[0.1] border-emerald-500/20 text-emerald-400'
                          : glossaryPushStatus === 'error'
                          ? 'bg-red-500/[0.08] border-red-500/20 text-red-400'
                          : 'dark:bg-white/[0.03] bg-[#FAF9F6] dark:border-white/[0.08] border-black/[0.13] text-gray-300 hover:dark:bg-white/[0.05] bg-[#F6F5F2]'
                      }`}
                    >
                      {glossaryPushStatus === 'pushing' ? (
                        <span className="flex items-center justify-center gap-1.5"><SpinnerIcon />Exporting...</span>
                      ) : glossaryPushStatus === 'done' ? (
                        <span className="flex items-center justify-center gap-1.5">
                          <CheckCircleIcon />
                          {glossaryPageUrl ? (
                            <a href={glossaryPageUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                              Glossary exported
                            </a>
                          ) : 'Glossary exported'}
                        </span>
                      ) : glossaryPushStatus === 'error' ? 'Export failed, retry' : 'Export Glossary'}
                    </button>
                    <button
                      onClick={() => handleNotionPush('summaries')}
                      disabled={summaryPushStatus === 'pushing'}
                      className={`flex-1 h-9 rounded-xl text-xs font-semibold border transition-colors duration-150 active:scale-[0.97] ${
                        summaryPushStatus === 'done'
                          ? 'bg-emerald-500/[0.1] border-emerald-500/20 text-emerald-400'
                          : summaryPushStatus === 'error'
                          ? 'bg-red-500/[0.08] border-red-500/20 text-red-400'
                          : 'dark:bg-white/[0.03] bg-[#FAF9F6] dark:border-white/[0.08] border-black/[0.13] text-gray-300 hover:dark:bg-white/[0.05] bg-[#F6F5F2]'
                      }`}
                    >
                      {summaryPushStatus === 'pushing' ? (
                        <span className="flex items-center justify-center gap-1.5"><SpinnerIcon />Exporting...</span>
                      ) : summaryPushStatus === 'done' ? (
                        <span className="flex items-center justify-center gap-1.5">
                          <CheckCircleIcon />
                          {summaryPageUrl ? (
                            <a href={summaryPageUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                              Summaries exported
                            </a>
                          ) : 'Summaries exported'}
                        </span>
                      ) : summaryPushStatus === 'error' ? 'Export failed, retry' : 'Export Summaries'}
                    </button>
                  </div>

                  {/* Pull section */}
                  <div className="mt-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-600 mb-2">Import from Notion</p>
                    {notionPages.length === 0 ? (
                      <button
                        onClick={loadNotionPages}
                        disabled={notionPullStatus === 'loading_pages'}
                        className="w-full h-9 rounded-xl dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.08] border-black/[0.13] text-xs font-medium text-gray-300 hover:dark:bg-white/[0.05] bg-[#F6F5F2] transition-colors duration-150 active:scale-[0.97]"
                      >
                        {notionPullStatus === 'loading_pages' ? (
                          <span className="flex items-center justify-center gap-1.5"><SpinnerIcon />Loading pages...</span>
                        ) : 'Browse my Notion pages'}
                      </button>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <select
                          value={selectedPageId}
                          onChange={e => setSelectedPageId(e.target.value)}
                          className="w-full h-9 rounded-xl dark:bg-white/[0.04] bg-[#FAF9F6] border dark:border-white/[0.08] border-black/[0.13] text-sm text-gray-200 px-3 focus:outline-none focus:border-yellow-500/40 transition-colors duration-150 appearance-none"
                        >
                          {notionPages.map(p => (
                            <option key={p.id} value={p.id} className="dark:bg-[#0d0d1c] bg-gray-50">{p.title}</option>
                          ))}
                        </select>
                        {notionPullStatus === 'done' && notionPullResult ? (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-emerald-400 flex items-center gap-1.5">
                              <CheckCircleIcon />
                              {notionPullResult.term_count} terms detected
                            </span>
                            <button
                              onClick={() => router.push('/history')}
                              className="text-xs font-medium dark:text-yellow-400 text-yellow-700 hover:dark:text-yellow-300 text-yellow-700 transition-colors duration-150 active:scale-[0.97]"
                            >
                              View in History
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={handleNotionImport}
                            disabled={!selectedPageId || notionPullStatus === 'importing'}
                            className={`w-full h-9 rounded-xl text-xs font-semibold transition-colors duration-150 active:scale-[0.97] ${
                              notionPullStatus === 'importing'
                                ? 'bg-yellow-500/30 dark:text-yellow-300 text-yellow-700 cursor-not-allowed'
                                : 'bg-yellow-600 hover:bg-yellow-500 dark:text-white text-gray-900'
                            }`}
                          >
                            {notionPullStatus === 'importing' ? (
                              <span className="flex items-center justify-center gap-1.5"><SpinnerIcon />Importing...</span>
                            ) : 'Import Selected Page'}
                          </button>
                        )}
                        {notionPullError && <p className="text-xs text-red-400">{notionPullError}</p>}
                      </div>
                    )}
                  </div>

                  {/* Disconnect */}
                  <div className="pt-2 border-t dark:border-white/[0.05] border-black/[0.06]">
                    <button
                      onClick={handleDisconnectNotion}
                      className="text-xs text-gray-600 hover:text-gray-600 transition-colors duration-150 active:scale-[0.97]"
                    >
                      Disconnect Notion
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}

// ---- Icons ----

function YouTubeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z" />
    </svg>
  )
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

function SlidesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

function NotionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933z" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  )
}

function AudioFileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  )
}

function DocFileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"
      className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
