const path = require('path')
const express = require('express')
const publicIP = require('public-ip')

let ChatangleFileServer = null

const DEFAULT_OPTIONS = {
  name: 'Chatangle',
  onError: () => {},
  onStarted: () => {},
  onStopped: () => {},
  onMessage: (message) => {}
}

async function buildChatangle() {
  const chatanglePath = path.dirname(require.resolve('chatangle'))
  const oldCWD = process.cwd()
  process.chdir(chatanglePath)
  const thisIP = await publicIP.v4()
  process.env.CHATANGLE_BACKEND_IP = thisIP
  process.env.IOTA_PROVIDERS_JSON = JSON.stringify([
    `http://${thisIP}:14265`
  ]).replace(/"/g, '\\"')
  require(path.join(chatanglePath, 'build', 'build'))
  // TODO: FIXME: figure out how to make a callback for building chatangle
  return new Promise((resolve) => {
    setTimeout(() => {
      process.chdir(oldCWD)
      resolve()
    }, 120000)
  })
}

class Chatangle {
  constructor (options) {
    this.opts = Object.assign({}, DEFAULT_OPTIONS, options)
    this.running = false
  }

  async start() {
    if(ChatangleFileServer) { return }
    const { onError, onStarted } = this.opts;

    console.log('building chatangle')
    await buildChatangle()
    console.log('built chatangle')

    try {
      const chatanglePath = path.dirname(require.resolve('chatangle'))
      express()
        .use(express.static(path.join(chatanglePath, 'dist')))
        .use(function(req, res, next) {
          res.header('Access-Control-Allow-Origin', '*');
          res.header(
            'Access-Control-Allow-Headers',
            'Origin, X-Requested-With, Content-Type, Accept, X-IOTA-API-Version'
          );
          next();
        })
        .get('/', (req, res) =>
          res.sendFile(path.join(__dirname, '..', 'node_modules', 'chatangle', 'dist', 'index.html'))
        )
        .listen(8085, () => {
          this.running = true
          this.opts.onMessage('started')
          onStarted && onStarted()
        })
    } catch(error) {
      onError(error)
      throw error
    }
  }

  async stop() {
    if(!ChatangleFileServer) { return }
    const { onStopped, onError } = this.opts
    try {
      ChatangleFileServer = null
    } catch(error) {
      return onError && onError(error)
    }
    this.opts.onMessage('stopped')
    this.running = false
    onStopped && onStopped()
  }

  isRunning() {
    return this.running
  }
}

module.exports = {
  Chatangle,
  DEFAULT_OPTIONS
}