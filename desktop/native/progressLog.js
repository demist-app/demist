// desktop/native/progressLog.js: FULL REPLACEMENT
// Same 10%-step console logging as before, plus an optional emit hook so
// download progress reaches the renderer (the worker passes one that posts
// a modelProgress event). Model downloads were previously console-only:
// a first-run user staring at a frozen-looking app for minutes had no way
// to know a multi-hundred-MB download was happening.

// transformers.js fires the same initiate/progress/ready events whether a file
// is coming off Hugging Face or off the local disk, and this logger called all
// of it "downloading". Since the transcription models started shipping inside
// the package that is actively misleading: the very first thing a new user sees
// is a download bar for a model that is already on their machine, which says
// the app needs a connection it does not need. That is the impression the
// certification failure was about, arriving by a different route.
//
// There is no flag on the event to distinguish the two, and rather than add one
// to the worker protocol the RENDERER decides, from the only signal that
// reliably separates them: a real download reports intermediate percentages
// over seconds, a local read jumps to done. See the modelProgress handler in
// web/lib/recordingSession.tsx. This file just stops asserting the wrong one.
function makeProgressLogger(label, emit) {
  const lastLoggedPct = new Map() // file -> last logged percent
  return (info) => {
    if (info.status === 'initiate') {
      console.log(`[demist] ${label}: reading ${info.file}...`)
      emit?.(label, 0, info.file)
    } else if (info.status === 'progress') {
      const last = lastLoggedPct.get(info.file) ?? -1
      const pct = Math.floor(info.progress ?? 0)
      if (pct >= last + 10) {
        lastLoggedPct.set(info.file, pct)
        console.log(`[demist] ${label}: ${info.file} ${pct}%`)
        emit?.(label, pct, info.file)
      }
    } else if (info.status === 'ready') {
      console.log(`[demist] ${label}: model ready`)
      emit?.(label, 100, null)
    }
  }
}

module.exports = { makeProgressLogger }
