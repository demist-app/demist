const { parentPort } = require('worker_threads')
let got = 0
parentPort.on('message', (m) => {
  if (m.type === 'reset') { got = 0; return }
  got++
})
setInterval(() => parentPort.postMessage({ got }), 200).unref()
