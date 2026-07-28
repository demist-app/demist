// Previews cost a full inference on the same worker real transcription needs.
// On a machine that cannot afford them they must switch OFF, not keep firing:
// a shipped session logged "preview of 1.8s in 26154 ms", blocking the worker
// for 26 seconds so no PCM was read and nothing could be transcribed.
//
// Drives a real session and asserts that once transcription is measured
// slower than PREVIEW_BUDGET_RATIO, no further preview is issued.
// Forces the budget so the disable path is exercised on any machine. Without
// this the test passes vacuously on a fast dev box, which it did at first.
process.env.DEMIST_PREVIEW_BUDGET_RATIO = process.env.DEMIST_PREVIEW_BUDGET_RATIO || '0.001'
const path = require('path'), fs = require('fs')
const { Worker } = require('worker_threads')
const SR = 16000
function readWav(f){const b=fs.readFileSync(f);let o=12
  while(o<b.length){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4)
    if(id==='data'){const n=sz/2,out=new Float32Array(n)
      for(let i=0;i<n;i++)out[i]=b.readInt16LE(o+8+i*2)/32768;return out}
    o+=8+sz+(sz%2)}}
const w=new Worker(path.join(__dirname,'..','native','worker.js'))
let id=0;const pending=new Map();const diags=[]
w.on('message',m=>{
  if(m.event==='diag'){diags.push(m.payload.message);return}
  if(m.event)return
  const e=pending.get(m.id);if(!e)return;pending.delete(m.id)
  m.error?e.reject(new Error(m.error)):e.resolve(m.result)})
const call=(t,...a)=>new Promise((res,rej)=>{const i=++id;pending.set(i,{resolve:res,reject:rej});w.postMessage({id:i,type:t,args:a})})
const feed=a=>{const c=new Float32Array(a);w.postMessage({type:'pcm',buffer:c.buffer},[c.buffer])}
const tone=s=>Float32Array.from({length:Math.round(s*SR)},()=>(Math.random()-0.5)*0.003)
;(async()=>{
  const sp=readWav(path.join(__dirname,'fixtures','speech.wav'))
  const parts=[tone(0.5)]
  for(let i=0;i<6;i++){parts.push(sp.subarray(0,Math.round(3*SR)));parts.push(tone(1.2))}
  const audio=new Float32Array(parts.reduce((n,a)=>n+a.length,0))
  let o=0;for(const p of parts){audio.set(p,o);o+=p.length}
  await call('preloadWhisper'); await call('startSession')
  const batch=Math.round(SR*0.1)
  // Faster than real time so the machine is provably behind.
  for(let i=0;i<audio.length;i+=batch){feed(audio.subarray(i,i+batch));await new Promise(r=>setTimeout(r,8))}
  await call('stopSession')

  const disabledAt=diags.findIndex(d=>d.startsWith('previews disabled'))
  const previewsAfter=disabledAt<0?[]:diags.slice(disabledAt).filter(d=>d.startsWith('preview of'))
  console.log(`diag lines: ${diags.length}`)
  console.log(`previews issued in total: ${diags.filter(d=>d.startsWith('preview of')).length}`)
  console.log(`previews disabled: ${disabledAt>=0?'yes -> '+diags[disabledAt]:'no'}`)
  console.log(`previews issued AFTER being disabled: ${previewsAfter.length}`)
  const ok = disabledAt >= 0 && previewsAfter.length === 0
  console.log(ok?'\nok: no preview ran after the budget was blown':'\nFAIL: previews kept running')
  process.exit(ok?0:1)
})()
