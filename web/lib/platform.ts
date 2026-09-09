// Shared OS/platform detection. Pulled out of InstallPrompt.tsx (which had
// its own ad-hoc UA-sniffing) so the web-trial gate and the install nudge
// use the exact same definition of "does a desktop app exist for this
// visitor" rather than two copies that can drift - the same reason
// lib/links.ts centralizes install URLs (they drifted into copies once
// already).

// null means no desktop app exists for this visitor at all (Linux, mobile,
// unknown) - callers should treat that as "nowhere to send them", not as an
// error case.
export type DesktopPlatform = 'windows' | 'mac' | null

export function detectDesktopPlatform(): DesktopPlatform {
  const ua = navigator.userAgent
  // iPadOS 13+ reports as "Macintosh" in its UA string by default (desktop
  // Safari spoofing), so the iPhone/iPad/iPod exclusion has to come first or
  // an iPad would be misread as a real Mac with nowhere to actually run the
  // desktop app.
  if (/iPhone|iPad|iPod/.test(ua)) return null
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac'
  if (/Windows NT/.test(ua)) return 'windows'
  return null
}

export function isMobileUA(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}
