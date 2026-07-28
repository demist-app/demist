const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('rate', {
  post: (buf) => ipcRenderer.postMessage('rate:post', { buffer: buf }),
  send: (buf) => ipcRenderer.send('rate:send', { buffer: buf }),
  done: (n) => ipcRenderer.send('rate:done', n),
})
