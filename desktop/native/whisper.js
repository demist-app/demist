// On-device transcription via whisper.cpp (through the nodejs-whisper
// binding). Replaces the Groq/OpenAI Whisper edge function call for desktop
// app users — audio never leaves the machine.
//
// nodejs-whisper's API takes a file path, not a buffer, so each chunk is
// written to a temp WAV file, transcribed, then cleaned up.

const { nodewhisper } = require('nodejs-whisper')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')

// English-only model: lecture audio is English-source (translation is a
// separate step), and the .en variant is smaller/faster than multilingual
// for the same size class. base.en balances accuracy and speed on an
// ordinary laptop CPU better than tiny.en; swap for small.en if quality
// needs to go up and users' hardware can take it.
const MODEL_NAME = 'base.en'
const MODEL_ROOT = path.join(os.homedir(), '.demist', 'whisper-models')

// mimeType matches what the web app's MediaRecorder actually produced
// (audio/webm;codecs=opus, audio/webm, or audio/mp4 — see doChunk() in
// dashboard/page.tsx). nodejs-whisper shells out to ffmpeg internally to
// convert to the 16kHz WAV whisper.cpp needs, so the temp file's extension
// has to match the real container format, not be hardcoded to .wav.
function extFor(mimeType) {
  if (mimeType?.includes('mp4')) return 'mp4'
  return 'webm'
}

async function transcribe(audioBuffer, mimeType) {
  const tmpFile = path.join(os.tmpdir(), `demist-chunk-${Date.now()}.${extFor(mimeType)}`)
  await fs.writeFile(tmpFile, Buffer.from(audioBuffer))
  try {
    const result = await nodewhisper(tmpFile, {
      modelName: MODEL_NAME,
      autoDownloadModelName: MODEL_NAME,
      modelRootPath: MODEL_ROOT,
      whisperOptions: { outputInText: true },
    })
    return typeof result === 'string' ? result.trim() : ''
  } finally {
    await fs.unlink(tmpFile).catch(() => {})
  }
}

module.exports = { transcribe }
