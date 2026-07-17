// On-device transcription via Whisper, running through @huggingface/transformers
// (onnxruntime-node under the hood): the same library and pattern as
// native/translate.js, not the nodejs-whisper/whisper.cpp binding this
// started with.
//
// nodejs-whisper was dropped: it compiles whisper.cpp from source with CMake
// on every fresh install, which needs a full C++ build toolchain (Visual
// Studio Build Tools on Windows). No end user downloading this app has that
// installed; it's a fine choice for a developer's own machine, not for
// something distributed. This path ships as ONNX weights with no
// compilation step at all, consistent with how translation already works.
//
// The renderer sends WebM/Opus (from MediaRecorder), but Whisper needs a
// 16kHz mono Float32Array. ffmpeg-static bundles a prebuilt ffmpeg binary
// (downloaded as a precompiled executable at install time, not built from
// source) purely to do that format conversion: audio never leaves the
// machine, this is a local decode step only.

const { pipeline } = require('@huggingface/transformers')
const wavefile = require('wavefile')
const ffmpegPath = require('ffmpeg-static')
const { execFile } = require('child_process')
const { promisify } = require('util')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { randomUUID } = require('crypto')
const { makeProgressLogger } = require('./progressLog')

const execFileAsync = promisify(execFile)

// English-only model: lecture audio is English-source (translation is a
// separate step), and the .en variant is smaller/faster than multilingual
// for the same size class.
const MODEL_ID = 'Xenova/whisper-base.en'

let transcriberPromise = null
function getTranscriber() {
  transcriberPromise ??= pipeline('automatic-speech-recognition', MODEL_ID, {
    progress_callback: makeProgressLogger('transcription model'),
  })
  return transcriberPromise
}

function extFor(mimeType) {
  if (mimeType?.includes('mp4')) return 'mp4'
  return 'webm'
}

async function decodeToFloat32(audioBuffer, mimeType) {
  // randomUUID, not Date.now(): a chunk transcribe() can still be running
  // (its ffmpeg subprocess or Whisper inference in progress) when the next
  // chunk's decode starts, since those are all awaits within the same
  // worker thread rather than serialized — Date.now() collided across
  // overlapping calls often enough in practice to corrupt or truncate
  // whichever chunk's temp files got clobbered, producing the garbled,
  // repeated-hallucination transcripts seen in testing.
  const id = randomUUID()
  const inFile = path.join(os.tmpdir(), `demist-in-${id}.${extFor(mimeType)}`)
  const outFile = path.join(os.tmpdir(), `demist-out-${id}.wav`)
  await fs.writeFile(inFile, Buffer.from(audioBuffer))
  try {
    // Direct binary path, not process.execPath: this is exactly what
    // nodejs-whisper got wrong under Electron (it resolves execPath
    // internally for its own build tooling, which points at electron.exe
    // here, not node.exe). execFile with an explicit path has no such
    // ambiguity.
    await execFileAsync(ffmpegPath, ['-y', '-i', inFile, '-ar', '16000', '-ac', '1', outFile])
    const wav = new wavefile.WaveFile(await fs.readFile(outFile))
    wav.toBitDepth('32f')
    wav.toSampleRate(16000)
    let samples = wav.getSamples()
    if (Array.isArray(samples)) samples = samples[0] // first channel if multi-channel
    // wavefile hands back a Float64Array regardless of the '32f' bit depth
    // set above (verified: that setting affects the WAV encoding, not this
    // return type); the pipeline expects Float32Array specifically.
    return Float32Array.from(samples)
  } finally {
    await fs.unlink(inFile).catch(() => {})
    await fs.unlink(outFile).catch(() => {})
  }
}

async function transcribe(audioBuffer, mimeType) {
  const audioData = await decodeToFloat32(audioBuffer, mimeType)
  const transcriber = await getTranscriber()
  const result = await transcriber(audioData)
  return (result?.text ?? '').trim()
}

module.exports = { transcribe }
