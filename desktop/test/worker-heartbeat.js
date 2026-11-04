// A forked worker must keep proving it is alive while idle or waiting on
// llama-server: main.js kills workers that stay silent past a call's timeout.
//   node test/worker-heartbeat.js
const { fork } = require('child_process')
const path = require('path')

const child = fork(path.join(__dirname, '../native/worker.js'), [], { serialization: 'advanced' })
const timer = setTimeout(() => { console.error('FAIL no heartbeat in 25s'); child.kill(); process.exit(1) }, 25_000)
child.on('message', (msg) => {
  if (msg.event !== 'alive') return
  clearTimeout(timer)
  console.log('ok   worker sent a heartbeat')
  child.kill()
  process.exit(0)
})
