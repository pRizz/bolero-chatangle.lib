const IOTATransactionStreamLib = require('iota-transaction-stream')

const DEFAULT_OPTIONS = {
    name: 'IOTATransactionStream',
    onError: () => {},
    onStarted: () => {},
    onStopped: () => {},
    onMessage: (message) => {}
}

class IOTATransactionStream {
    constructor (options) {
        this.opts = Object.assign({}, DEFAULT_OPTIONS, options)
        this.running = false
    }

    async start() {
        const { onError, onStarted } = this.opts;

        try {
            IOTATransactionStreamLib.start({
                port: 8007,
                iotaIP: 'localhost',
                iotaZMQPort: 5556
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
            await IOTATransactionStreamLib.stop()
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
    IOTATransactionStream,
    DEFAULT_OPTIONS
}