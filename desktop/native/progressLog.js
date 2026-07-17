// Shared progress_callback for @huggingface/transformers' pipeline(), used
// by both translate.js and whisper.js. Model downloads were previously
// silent end to end, making "still downloading a multi-hundred-MB file" and
// "actually stuck" indistinguishable from the console. Logs at 10% steps
// per file rather than on every chunk.

function makeProgressLogger(label) {
  const lastLoggedPct = new Map() // file -> last logged percent
  return (info) => {
    if (info.status === 'initiate') {
      console.log(`[demist] ${label}: downloading ${info.file}...`)
    } else if (info.status === 'progress') {
      const last = lastLoggedPct.get(info.file) ?? -1
      const pct = Math.floor(info.progress ?? 0)
      if (pct >= last + 10) {
        lastLoggedPct.set(info.file, pct)
        console.log(`[demist] ${label}: ${info.file} ${pct}%`)
      }
    } else if (info.status === 'ready') {
      console.log(`[demist] ${label}: model ready`)
    }
  }
}

module.exports = { makeProgressLogger }
