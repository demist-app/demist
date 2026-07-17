// desktop/native/progressLog.js: FULL REPLACEMENT
// Same 10%-step console logging as before, plus an optional emit hook so
// download progress reaches the renderer (the worker passes one that posts
// a modelProgress event). Model downloads were previously console-only:
// a first-run user staring at a frozen-looking app for minutes had no way
// to know a multi-hundred-MB download was happening.

function makeProgressLogger(label, emit) {
  const lastLoggedPct = new Map() // file -> last logged percent
  return (info) => {
    if (info.status === 'initiate') {
      console.log(`[demist] ${label}: downloading ${info.file}...`)
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
