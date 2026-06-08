let wakeLock: WakeLockSentinel | null = null
let visibilityListenerAttached = false

export const wakeLockSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'wakeLock' in navigator

export const requestWakeLock = async (): Promise<void> => {
  if (!wakeLockSupported()) {
    console.log('Wake Lock API not supported')
    return
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    wakeLock.addEventListener('release', () => {
      wakeLock = null
    })
  } catch (err) {
    console.log('Wake lock request failed:', err)
  }
}

export const releaseWakeLock = async (): Promise<void> => {
  if (wakeLock) {
    await wakeLock.release()
    wakeLock = null
  }
}

export const reacquireWakeLockOnVisibility = (): void => {
  if (visibilityListenerAttached) return
  visibilityListenerAttached = true
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && wakeLock === null) {
      await requestWakeLock()
    }
  })
}
