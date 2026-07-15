export const tabCaptureSupported = (): boolean =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  !!navigator.mediaDevices.getDisplayMedia

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

    // Check the user actually shared a tab with audio
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      stream.getTracks().forEach(t => t.stop())
      throw new Error('No audio track found. Make sure to share a tab, not a window or screen.')
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
