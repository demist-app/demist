// Raw llama.cpp speed on CPU for the bundled tiers: prompt-read (prefill) and
// generation tokens/sec, at different thread counts. Separates "the model is
// slow on this CPU" from "our pipeline does too much".
//   node test/llama-cpu-speed.mjs tiny 4,6,12
import { getLlama, LlamaChatSession } from 'node-llama-cpp'
import os from 'os'
import path from 'path'
const tier = process.argv[2] || 'tiny'
const threadList = (process.argv[3] || '4,12').split(',').map(Number)
const FILE = { tiny: 'hf_bartowski_Qwen2.5-1.5B-Instruct.Q4_K_M.gguf', small: 'hf_bartowski_Llama-3.2-3B-Instruct.Q4_K_M.gguf' }[tier]
const llama = await getLlama({ gpu: false })
console.log('backend', llama.gpu, 'cpu threads seen', os.cpus().length, 'llama.cpuMathCores', llama.cpuMathCores)
const model = await llama.loadModel({ modelPath: path.join(os.homedir(), '.demist', 'llm-models', FILE) })
const prompt = 'You are a study assistant. From the lecture excerpt below, identify at most 2 subject-specific technical terms a Year 2 Biology student is unlikely to know.\n\nLecture excerpt:\nChemiosmosis drives ATP synthase using the proton motive force across the inner mitochondrial membrane. This gradient is what couples respiration to ATP production.\n\nRespond with each term on its own line in exactly this format:\nTERM: <term> | DEFINITION: <one sentence> | CONTEXT: <sentence>\n\nIf nothing qualifies, respond with exactly: NONE'
for (const threads of threadList) {
  const context = await model.createContext({ contextSize: 2048, threads })
  const session = new LlamaChatSession({ contextSequence: context.getSequence() })
  // warm
  await session.prompt('Say OK.', { maxTokens: 4 }); session.resetChatHistory()
  const nPrompt = model.tokenize(prompt).length
  let firstTokenAt = 0, nOut = 0
  const t0 = Date.now()
  await session.prompt(prompt, { maxTokens: 120, onTextChunk: () => { if (!firstTokenAt) firstTokenAt = Date.now(); nOut++ } })
  const t1 = Date.now()
  const prefill = firstTokenAt - t0, gen = t1 - firstTokenAt
  console.log(`threads ${String(threads).padStart(2)}: prompt ${nPrompt} tok read in ${prefill}ms (${Math.round(nPrompt / (prefill / 1000))} tok/s), ${nOut} chunks generated in ${gen}ms (${(nOut / (gen / 1000)).toFixed(1)}/s), total ${t1 - t0}ms`)
  await context.dispose()
}
process.exit(0)
