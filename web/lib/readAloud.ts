'use client'

// Free on-device text-to-speech for transcript read-back (dyslexia/accessibility).
// Tracks the currently-spoken sentence so the UI can highlight it.
// Premium neural voice swaps in later behind Pro at the marked line.

import { useCallback, useEffect, useRef, useState } from 'react'

function splitSentences(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = []
  const re = /[^.!?]+[.!?]*\s*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m[0].trim()) out.push({ text: m[0], start: m.index })
  }
  return out.length ? out : [{ text, start: 0 }]
}

export function useReadAloud(fullText: string) {
  const [speaking, setSpeaking] = useState(false)
  const [paused, setPaused] = useState(false)
  const [activeSentence, setActiveSentence] = useState<number>(-1)
  const sentencesRef = useRef(splitSentences(fullText))
  const idxRef = useRef(0)

  useEffect(() => { sentencesRef.current = splitSentences(fullText) }, [fullText])

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  const speakFrom = useCallback((i: number) => {
    if (!supported) return
    const list = sentencesRef.current
    if (i >= list.length) { setSpeaking(false); setActiveSentence(-1); return }
    idxRef.current = i
    setActiveSentence(i)
    // TODO premium voice: if useEntitlements().isPro, call neural TTS here instead.
    const u = new SpeechSynthesisUtterance(list[i].text)
    u.rate = 0.95
    u.onend = () => {
      if (idxRef.current === i) speakFrom(i + 1)
    }
    window.speechSynthesis.speak(u)
  }, [supported])

  const play = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.cancel()
    setSpeaking(true); setPaused(false)
    speakFrom(0)
  }, [supported, speakFrom])

  const pause = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.pause(); setPaused(true)
  }, [supported])

  const resume = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.resume(); setPaused(false)
  }, [supported])

  const stop = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.cancel()
    setSpeaking(false); setPaused(false); setActiveSentence(-1)
  }, [supported])

  useEffect(() => () => { if (supported) window.speechSynthesis.cancel() }, [supported])

  return { supported, speaking, paused, activeSentence, sentences: sentencesRef.current, play, pause, resume, stop }
}
