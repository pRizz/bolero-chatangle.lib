const path = require('path');
const fs = require('fs');
const installer = require('./installer');
const iri = require('./iri');
const nelson = require('./nelson');
// const field = require('./field');
const system = require('./system');
const settings = require('./settings');
const chatangleBackend = require('./chatangleBackend')
const chatangle = require('./chatangle')
const iotaTransactionStream = require('./iotaTransactionStream')

const DEFAULT_OPTIONS = {
    targetDir: null,
    maxMessages: 1000,
    onStateChange: (state) => {},
    onMessage: (messages) => {},
};

class Controller {
    constructor(options) {
        this.opts = Object.assign({}, DEFAULT_OPTIONS, options);
        this.state = {};
        this.messages = {
            iri: [],
            system: [],
            database: [],
            nelson: [],
            // field: []
            chatangleBackend: [],
            chatangle: [],
            iotaTransactionStream: []
        };
        const targetDir = this.opts.targetDir || path.join(process.cwd(), 'data');
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir);
        }
        this.targetDir = targetDir;
        this.settings = new settings.Settings({
            basePath: this.targetDir
        });
        this.iriInstaller = new installer.iri.IRIInstaller({ targetDir });
        this.databaseInstaller = new installer.database.DatabaseInstaller({
            settings: this.settings,
            targetDir,
            onMessage: (message) => this.message('database', message)
        });
        this.reloadSystems();
        this.system = new system.System({
            onMessage: (message) => this.message('system', message)
        });
        this.state = {
            system: {
                status: 'waiting',
                hasEnoughSpace: false,
                hasEnoughMemory: false,
                hasJavaInstalled: false,
                isSupportedPlatform: false
            },
            iri: {
                status: 'waiting'
            },
            nelson: {
                status: 'waiting'
            },
            field: {
                status: 'waiting'
            },
            database: {
                status: 'waiting'
            },
            chatangleBackend: {
                status: 'waiting'
            },
            chatangle: {
                status: 'waiting'
            },
            iotaTransactionStream: {
                status: 'waiting'
            }
        };
        this.updater = null;
        this.updateCounter = 0;
        this.updateState = this.updateState.bind(this);
    }

    reloadSystems () {
        this.iri = new iri.IRI({
            port: this.settings.settings.iriPort,
            isPublic: this.settings.settings.iriPublic,
            iriPath: this.iriInstaller.getTargetFileName(),
            dbPath: this.databaseInstaller.targetDir,
            onError: (err) => {
                this.message('iri', `ERROR: ${err ? err.message : ''}`);
                this.updateState('iri', { status: 'error', error: err ? err.message : '' })
            },
            onMessage: (message) => this.message('iri', message)
        });
        this.nelson = new nelson.Nelson({
            name: this.settings.settings.name,
            protocol: this.settings.settings.protocol,
            dataPath: this.targetDir,
            onError: (err) => {
                this.message('nelson', `ERROR: ${err ? err.message : ''}`);
                this.updateState('nelson', { status: 'error', error: err ? err.message : '' })
            },
            onMessage: (message) => this.message('nelson', message)
        });
        this.chatangleBackend = new chatangleBackend.ChatangleBackend({
            onError: (err) => {
                this.message('chatangleBackend', `ERROR: ${err ? err.message : ''}`);
                this.updateState('chatangleBackend', { status: 'error', error: err ? err.message : '' })
            },
            onMessage: (message) => this.message('chatangleBackend', message)
        })
        this.chatangle = new chatangle.Chatangle({
            onError: (err) => {
                this.message('chatangle', `ERROR: ${err ? err.message : ''}`);
                this.updateState('chatangle', { status: 'error', error: err ? err.message : '' })
            },
            onMessage: (message) => this.message('chatangle', message)
        })
        this.iotaTransactionStream = new iotaTransactionStream.IOTATransactionStream({
            onError: (err) => {
                this.message('iotaTransactionStream', `ERROR: ${err ? err.message : ''}`);
                this.updateState('iotaTransactionStream', { status: 'error', error: err ? err.message : '' })
            },
            onMessage: (message) => this.message('iotaTransactionStream', message)
        })
    }

    tick () {
        const getNelsonInfo = () => {
            if (this.state.nelson.status === 'running') {
                const info = this.nelson.getNodeInfo();
                this.updateState('nelson', { info });
                this.updateCounter += 1;
            } else if (this.state.nelson.status === 'error') {
                this.message('nelson', 'Service seems down, trying to restart...');
                setTimeout(() => this.nelson.stop().then(() => this.nelson.start()), 5000);
            }
        };
        if (this.state.iri.status === 'running') {
            this.iri.getNodeInfo().then((info) => {
                this.updateState('iri', { info });
                getNelsonInfo();
            }).catch((err) => {
                this.message('iri', 'Failed getting IRI API update...');
                this.updateState('iri', { status: 'error', error: err.message });
                getNelsonInfo();
            });
        } else if (this.state.iri.status === 'error') {
            this.message('iri', 'IRI seems down, trying to restart in 2 seconds...');
            this.iri.stop();
            getNelsonInfo();
            setTimeout(() => this.iri.start(), 2000);
        }
    }

    async start () {
        if(! await this.checkSystem()) {
            return
        }

        try {
            await this.install('iri')
            await this.install('database')
        } catch(error) {
            this.message('iri', 'Installation failed');
            this.message('database', 'Installation failed');
            throw error
        }

        await this.startIRI()
        await this.startNelson()
        await this.startIOTATransactionStream()
        await this.startChatangleBackend()
        await this.startChatangle()

        this.message('system', 'Installation succeeded!\nEnsure TCP ports 14265, 15600, 16600, 21310, and UDP ports 14600 are open.\nChatangle website is running on port 8085.');

        this.updater = setInterval(() => this.tick(), 5000);
    }

    async stop () {
        if (this.updater) {
            clearInterval(this.updater)
            this.updater = null
        }
        this.iri.stop('SIGKILL')
        this.updateState('iri', { status: 'stopped' })
        await this.nelson.stop()
        this.updateState('nelson', { status: 'stopped' })
        await this.iotaTransactionStream.stop()
        this.updateState('iotaTransactionStream', { status: 'stopped' })
        await this.chatangleBackend.stop()
        this.updateState('chatangleBackend', { status: 'stopped' })
        await this.chatangle.stop()
        this.updateState('chatangle', { status: 'stopped' })
        return true
    }

    // Wait for IRI network syncing and old transactions to flow through the ZMQ before listening
    // Else you get flooded with old transactions, denying service
    async iotaTransactionStreamDelay() {
        const delayInMinutes = 10
        const delayInMilliseconds = delayInMinutes * 60 * 1000
        this.message('iotaTransactionStream', `waiting ${delayInMinutes} minutes for Node to sync`);
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve()
            }, delayInMilliseconds)
        })
    }

    updateSettings (config) {
        const doNotStop = ['iri', 'database']
            .filter(k => ['checking', 'downloading'].includes(this.state[k].status))
            .length > 0;
        if (doNotStop) {
          this.settings.saveSettings(config);
          this.reloadSystems();
        }
        return this.stop().then(() => {
            this.settings.saveSettings(config);
            this.reloadSystems();
            return this.start();
        })
    }

    startIRI () {
        this.updateState('iri', { status: 'starting' });
        return new Promise((resolve) => {
            this.iri.start();

            const getNodeInfo = () => {
                setTimeout(() => {
                    this.iri.getNodeInfo().then((info) => {
                        this.message('iri', 'started');
                        this.updateState('iri', { status: 'running', info });
                        resolve();
                    }).catch(getNodeInfo);
                }, 1000)
            };
            getNodeInfo();
        });
    }

    startNelson () {
        this.updateState('nelson', { status: 'starting' });
        return new Promise((resolve) => {
            this.nelson.start().then(() => {
                this.updateState('nelson', { status: 'running', info: this.nelson.getNodeInfo() });
                resolve();
            });
        });
    }

    async startChatangleBackend() {
        this.updateState('chatangleBackend', { status: 'starting' })
        await this.chatangleBackend.start()
        this.updateState('chatangleBackend', { status: 'running' })
    }

    async startChatangle() {
        this.updateState('chatangle', { status: 'starting' })
        await this.chatangle.start()
        this.updateState('chatangle', { status: 'running' })
    }

    async startIOTATransactionStream () {
        this.updateState('iotaTransactionStream', { status: 'starting' })
        await this.iotaTransactionStreamDelay()
        await this.iotaTransactionStream.start()
        this.updateState('iotaTransactionStream', { status: 'running' })
    }

    checkSystem () {
        this.updateState('system', { status: 'checking' });
        return this.system.hasEnoughSpace(this.databaseInstaller.isInstalled()).then((hasEnoughSpace) => {
            this.updateState('system', { hasEnoughSpace });
            return this.system.hasJavaInstalled()
        }).then((hasJavaInstalled) => {
            this.updateState('system', { hasJavaInstalled });
        }).then(() => {
            const { hasEnoughSpace, hasJavaInstalled } = this.state.system;
            const isSupportedPlatform = this.system.isSupportedPlatform();
            const hasEnoughMemory = this.system.hasEnoughMemory();
            const isReady = isSupportedPlatform && hasEnoughMemory && hasEnoughSpace && hasJavaInstalled;
            this.updateState('system', {
                status: isReady ? 'ready' : 'error',
                isSupportedPlatform,
                hasEnoughMemory,
                error: hasEnoughSpace
                    ? hasJavaInstalled
                        ? isSupportedPlatform
                            ? hasEnoughMemory
                                ? ''
                                : 'not enough RAM (+3.6GB)'
                            : 'operating system is not supported'
                        : 'java v1.8.0_151 or higher is not installed'
                    : 'not enough free space in home or temp directory (+8GB)'
            });
            return isReady;
        })
    }

    install (component) {
        let installer = null;
        switch (component) {
            case 'iri':
                installer = this.iriInstaller;
                break;
            case 'database':
            default:
                installer = this.databaseInstaller;
        }
        this.updateState(component, { status: 'checking' });
        return new Promise((resolve, reject) => {
            if (installer.isInstalled()) {
                this.updateState(component, { status: 'ready' });
                resolve();
            } else {
                installer.install(
                    (progress) => this.updateState(component, { status: 'downloading', progress }),
                    () => {
                        this.updateState(component, { status: 'ready' });
                        resolve();
                    },
                    (error) => {
                        this.updateState(component, { status: 'error', error: error.message });
                        installer.uninstall();
                        reject(error);
                    }
                )
            }
        });
    }

    updateState (component, state) {
        this.state[component] = Object.assign(this.state[component], state);
        this.opts.onStateChange(this.state);
    }

    message (component, message) {
        this.messages[component].push(message);
        this.messages[component] = this.messages[component].splice(-this.opts.maxMessages);
        this.opts.onMessage(component, message, this.messages);
    }

    getState () {
        return this.state
    }
}

module.exports = {
    Controller,
    DEFAULT_OPTIONS
};
