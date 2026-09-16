// Turns "a model download failed" into something a user can act on.
//
// Confirmed twice in the wild: a school-managed device whose content filter
// categorises huggingface.co as AI and blocks it outright (the school's own
// block page confirmed it the first time). The term-detection and
// translation models are fetched from Hugging Face at runtime, so on those
// networks they never arrive, runNativePreload never flips
// nativeModelsReady, and the record button stays locked forever - on an app
// whose transcription models are bundled and would have worked fine.
//
// What the user saw was a raw "fetch failed" and a dead button. This does
// not fix the block (that needs the models served from somewhere the filter
// allows), but it replaces a dead end with the one instruction that
// actually works today: the web app has no Hugging Face dependency at all,
// so it runs on exactly the networks the desktop app cannot.
//
// whisper.js already does this for its own bundled-model case and its
// comment explains the constraint the wording has to respect: the renderer
// truncates this to 200 characters (recordingSession.tsx's
// setNativeModelsError), so the actionable sentence goes FIRST and the
// technical detail last, where truncation costs nothing.

// Matches the shapes a blocked or filtered network actually produces, rather
// than assuming one library's error text. undici (node-llama-cpp's fetch)
// reports "fetch failed" with a cause; transformers.js surfaces DNS and TLS
// failures; a filter that serves a block PAGE instead of the file produces a
// parse or status error instead of a connection one.
const BLOCKED_PATTERNS = /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|certificate|self.signed|unable to verify|terminated|network|403|407|451|502|503/i

function looksNetworkBlocked(err) {
  const text = [err?.message, err?.cause?.message, err?.code, err?.cause?.code]
    .filter(Boolean).join(' ')
  return BLOCKED_PATTERNS.test(text)
}

/**
 * Wraps a model-download failure in an explanation, when the failure looks
 * like a blocked network. Anything else is passed through untouched - a
 * genuine bug should not be mislabelled as a firewall.
 *
 * @param {Error} err the original failure
 * @param {string} what user-facing name of the model, e.g. "Term detection"
 */
function explainModelDownloadFailure(err, what) {
  if (!looksNetworkBlocked(err)) return err
  return new Error(
    `${what} could not download because this network blocks it. `
    + `School and work networks often block huggingface.co as "AI content". `
    + `Open demist.app in your browser instead - it needs no download and works on this network. `
    + `(underlying error: ${err?.message ?? err})`,
  )
}

module.exports = { looksNetworkBlocked, explainModelDownloadFailure }
