// Raw llama.cpp throughput through node-llama-cpp on CPU, bypassing
// LlamaChatSession, compared against the official llama-bench for the same
// build (b9842) and model on the same machine.
//
// WHY (2026-10-20): on an idle Ryzen 5 5600X, official llama-bench measured
// 189 tok/s prompt reading and 27 tok/s generation for Qwen2.5-1.5B Q4_K_M,
// while node-llama-cpp measured 16 and 6.5 - which alone made on-device term
// detection far too slow on laptops without a graphics card.
//
//   node test/llama-raw-eval.mjs '{"maxThreads":0,"threads":6,"batchSize":512,"flashAttention":false}'
import { getLlama } from 'node-llama-cpp'
import os from 'os'
import path from 'path'

const opt = JSON.parse(process.argv[2] || '{}')
const llama = await getLlama({ gpu: false, ...(opt.maxThreads !== undefined ? { maxThreads: opt.maxThreads } : {}) })
const model = await llama.loadModel({ modelPath: path.join(os.homedir(), '.demist', 'llm-models', 'hf_bartowski_Qwen2.5-1.5B-Instruct.Q4_K_M.gguf'), useMmap: opt.useMmap ?? true })
const ctxOpt = { contextSize: 2048 }
for (const k of ['threads', 'batchSize', 'flashAttention']) if (opt[k] !== undefined) ctxOpt[k] = opt[k]
const ctx = await model.createContext(ctxOpt)
const seq = ctx.getSequence()
const tokens = model.tokenize('Chemiosmosis drives ATP synthase using the proton motive force across the inner mitochondrial membrane. '.repeat(6))
// Warm-up so first-touch page faults are not counted.
await seq.evaluateWithoutGeneratingNewTokens(tokens.slice(0, 8))
await seq.clearHistory()
let t = Date.now()
await seq.evaluateWithoutGeneratingNewTokens(tokens)
const prefillMs = Date.now() - t
t = Date.now()
let n = 0
for await (const _ of seq.evaluate([model.tokenize(' The')[0]], { temperature: 0 })) { if (++n >= 40) break }
const genMs = Date.now() - t
console.log(`${JSON.stringify(opt)} -> prefill ${tokens.length} tok ${Math.round(tokens.length / (prefillMs / 1000))} tok/s, gen ${(n / (genMs / 1000)).toFixed(1)} tok/s (llama.cpuMathCores ${llama.cpuMathCores}, maxThreads ${llama.maxThreads})`)
process.exit(0)
