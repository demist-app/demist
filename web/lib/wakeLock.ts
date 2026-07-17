import { getDemistNative } from './electronNative'

let wakeLock: WakeLockSentinel | null = null
let visibilityListenerAttached = false

// The web Wake Lock API is present in Electron's bundled Chromium (so
// wakeLockSupported() below is true there too) but never actually grants:
// confirmed by real testing that navigator.wakeLock.request() still throws
// NotAllowedError inside the desktop app even with every permission handler
// on the main-process side allowing it. Electron's own powerSaveBlocker,
// bridged in as demistNative.startWakeLock/stopWakeLock, is what actually
// works there, so it takes priority over the web API when present.
export const wakeLockSupported = (): boolean =>
  !!getDemistNative() || (typeof navigator !== 'undefined' && 'wakeLock' in navigator)

export const requestWakeLock = async (): Promise<void> => {
  const native = getDemistNative()
  if (native) {
    await native.startWakeLock()
    return
  }
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
  const native = getDemistNative()
  if (native) {
    await native.stopWakeLock()
    return
  }
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
