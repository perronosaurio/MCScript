'use strict'

const { EventEmitter } = require('events')
const packets = require('../protocol/packets')
const { WebSocketTransport } = require('./websocket')

const MAX_BUFFER = 64 * 1024

// Wraps a TCP socket (or a WebSocket running over it) and turns the byte stream
// into decoded Classic/CPE packets.
class Connection extends EventEmitter {
  constructor (socket) {
    super()
    this.socket = socket
    this.transport = null // null = raw TCP, otherwise WebSocketTransport
    this.buffer = Buffer.alloc(0)
    this.closed = false
    this.fullCP437 = false
    this.socketIp = (socket.remoteAddress || '').replace(/^::ffff:/, '')
    this.forwardedFor = null // X-Forwarded-For of web clients behind a proxy (only trusted if configured)
    this.isWebSocket = false

    socket.setNoDelay(true)
    socket.on('data', data => this._onSocketData(data))
    socket.on('error', err => this.emit('socketError', err))
    socket.on('close', () => this._onClose())
  }

  _onSocketData (data) {
    if (this.closed) return
    if (this.transport === null && this.buffer.length === 0 && !this._sniffed) {
      this._sniffed = true
      // 'G' = HTTP GET => WebSocket upgrade (web client)
      if (data[0] === 0x47) {
        this.isWebSocket = true
        this.transport = new WebSocketTransport(this.socket)
        this.transport.on('data', d => this._onData(d))
      }
    }
    if (this.transport) {
      if (!this.transport.open) {
        if (this.transport.handshake(data)) this.forwardedFor = this.transport.remoteAddress
      } else {
        this.transport.receive(data)
      }
      return
    }
    this._onData(data)
  }

  _onData (data) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, data]) : data
    if (this.buffer.length > MAX_BUFFER) return this.kick('Too much data')

    while (this.buffer.length > 0 && !this.closed) {
      const id = this.buffer[0]
      const def = packets.CLIENT[id]
      if (!def) {
        this.emit('invalidPacket', id)
        return this.kick(`Unknown packet id ${id}`)
      }
      if (this.buffer.length < def.size) return
      const raw = this.buffer.subarray(0, def.size)
      this.buffer = this.buffer.subarray(def.size)
      let packet
      try {
        packet = packets.decode(id, raw)
      } catch (err) {
        return this.kick('Malformed packet')
      }
      this.emit('packet', packet)
      this.emit(packet.name, packet)
    }
  }

  writeRaw (buf) {
    if (this.closed || this.socket.destroyed) return
    if (this.transport) this.transport.write(buf)
    else this.socket.write(buf)
  }

  write (name, data) {
    this.writeRaw(packets.encode(name, data, { fullCP437: this.fullCP437 }))
  }

  kick (reason) {
    if (this.closed) return
    this.write('disconnect', { reason: String(reason).slice(0, 64) })
    this.close()
  }

  close () {
    if (this.closed) return
    this.closed = true
    const sock = this.socket
    if (this.transport) this.transport.close()
    else sock.end()
    // make sure we don't keep half-open sockets around
    setTimeout(() => sock.destroy(), 1000).unref()
    this._onClose()
  }

  _onClose () {
    if (this._closeEmitted) return
    this._closeEmitted = true
    this.closed = true
    this.emit('close')
  }
}

module.exports = { Connection }
