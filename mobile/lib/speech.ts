// Which speech engine a recording uses.
//
// 'analyzer': Apple's SpeechAnalyzer (iOS 26+), through our own native module
//   (modules/demist-speech). Far more accurate on lecture vocabulary.
// 'legacy': SFSpeechRecognizer through expo-speech-recognition, for older
//   iPhones and languages the new engine does not cover.
//
// Both run entirely on the phone, so "the sound never leaves it" holds
// whichever is chosen.
import { requireOptionalNativeModule } from 'expo'

export type SpeechEngine = 'analyzer' | 'legacy'

interface Subscription { remove(): void }
interface DemistSpeechNative {
  isAvailable(locale: string): Promise<boolean>
  prepare(locale: string): Promise<boolean>
  start(locale: string): Promise<void>
  stop(): Promise<void>
  addListener(event: 'onResult', listener: (e: { text: string; isFinal: boolean }) => void): Subscription
  addListener(event: 'onVolume', listener: (e: { level: number }) => void): Subscription
  addListener(event: 'onError', listener: (e: { code: string; message?: string }) => void): Subscription
  addListener(event: 'onEnd', listener: () => void): Subscription
}

/** Null in builds without the module (Expo Go, web, Android). */
export const analyzer = requireOptionalNativeModule<DemistSpeechNative>('DemistSpeech')

// The first use of a language downloads its model. Never make a student wait
// longer than this at the record button: the old engine takes this lecture,
// and the download carries on for the next one.
const PREPARE_WAIT_MS = 12_000

const ready = new Map<string, Promise<boolean>>()

/** Whether the new engine can take a recording in this locale right now. */
export function analyzerReady(locale: string): Promise<boolean> {
  if (!analyzer) return Promise.resolve(false)
  let p = ready.get(locale)
  if (!p) {
    p = analyzer.isAvailable(locale)
      .then(ok => ok ? analyzer.prepare(locale) : false)
      .catch(() => false)
    // A failed download is tried again next time rather than remembered.
    p.then(ok => { if (!ok) ready.delete(locale) })
    ready.set(locale, p)
  }
  return Promise.race([p, new Promise<boolean>(r => setTimeout(() => r(false), PREPARE_WAIT_MS))])
}
