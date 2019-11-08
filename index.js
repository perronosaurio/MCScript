const { createServer } = require('minecraft-classic-protocol')
const { protocol } = require('minecraft-classic-protocol-extension')
const { join } = require('path')

const EventEmitter = require('events').EventEmitter
const requireIndex = require('requireindex')

module.exports.createServer = (options = {}) => {
  const mcServer = new MCServer()
  options.customPackets = protocol
  mcServer.connect(options)

  return mcServer
}

class MCServer extends EventEmitter {
  constructor () {
    super()
    this._server = null
  }

  connect (options) {
    const plugins = requireIndex(join(__dirname, 'src', 'plugins'))
    this._server = createServer(options)

    Object.keys(plugins)
      .filter(pluginName => plugins[pluginName].server !== undefined)
      .forEach(pluginName => plugins[pluginName].server(this, options))

    this._server.on('error', error => this.emit('error', error))
    this._server.on('clientError', error => this.emit('error', error))
    this._server.on('listening', () => this.emit('listening', this._server.socketServer.address().port))
    this.emit('asap')
  }
}
