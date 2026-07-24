import { isElectronNative, getDemistNative } from '@/lib/electronNative'

export const tabCaptureSupported = (): boolean => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) return false
  if (!isElectronNative()) return true
  // Electron has no concept of tabs (unlike real Chrome, which mixes each
  // tab's audio independently), so desktop/main.js's setDisplayMediaRequestHandler
  // hands back Windows' system-audio loopback device instead: everything
  // currently playing on the machine, not one isolated tab. That's
  // documented by Electron as Windows-only and main.js only registers the
  // handler there, so anywhere else getDisplayMedia() would just reject.
  return getDemistNative()?.platform === 'win32'
}

export const startTabCapture = async (): Promise<MediaStream | null> => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: false, // audio only, no screen video
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: 44100,
      },
    })

    // Check there's actually an audio track: in the browser this means the
    // user picked a window/screen instead of a tab (no picker exists at all
    // for Electron's system-audio loopback, so this is unlikely to trigger
    // there, but the message is kept accurate for it regardless).
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      stream.getTracks().forEach(t => t.stop())
      throw new Error(isElectronNative()
        ? 'No system audio detected.'
        : 'No audio track found. Make sure to share a tab, not a window or screen.')
    }

    return stream
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err?.name === 'NotAllowedError') {
      // User cancelled the picker: handle gracefully
      return null
    }
    throw err
  }
}
