const ChatangleBackendLib = require('chatangle-backend')

const DEFAULT_OPTIONS = {
    name: 'ChatangleBackend',
    onError: () => {},
    onStarted: () => {},
    onStopped: () => {},
    onMessage: (message) => {}
}

class ChatangleBackend {
    constructor (options) {
        this.opts = Object.assign({}, DEFAULT_OPTIONS, options)
        this.running = false
    }

    async start() {
        const { onError, onStarted } = this.opts;

        try {
            ChatangleBackendLib.start({
                iotaTransactionStreamIP: 'localhost',
                iotaTransactionStreamPort: 8007,
                isIotaTransactionStreamSecured: false,
                webSocketServerPort: 8008
            })

            this.running = true
            this.opts.onMessage('started')
            onStarted && onStarted()
        } catch(error) {
            onError(error)
        }
    }

    async stop() {
        const { onStopped, onError } = this.opts
        try {
            await ChatangleBackendLib.stop()
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
    ChatangleBackend,
    DEFAULT_OPTIONS
}