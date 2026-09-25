'use strict'

// Minimal server-side WebSocket (RFC 6455) so the ClassiCube web client can connect
// on the same port as normal clients. Only binary frames are used by the client.

const crypto = require('crypto')
const { EventEmitter } = require('events')

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

class WebSocketTransport extends EventEmitter {
  constructor (socket) {
    super()
    this.socket = socket
    this.buffer = Buffer.alloc(0)
    this.fragments = []
    this.open = false
    this.closed = false
  }

  // Parses the HTTP upgrade request. Returns true when handshake is complete.
  handshake (data) {
    this.buffer = Buffer.concat([this.buffer, data])
    const end = this.buffer.indexOf('\r\n\r\n')
    if (end === -1) {
      if (this.buffer.length > 8192) this.socket.destroy()
      return false
    }
    const head = this.buffer.subarray(0, end).toString('latin1')
    const rest = this.buffer.subarray(end + 4)
    this.buffer = Buffer.alloc(0)

    const headers = {}
    for (const line of head.split('\r\n').slice(1)) {
      const i = line.indexOf(':')
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
    }
    this.remoteAddress = headers['x-forwarded-for'] ? headers['x-forwarded-for'].split(',')[0].trim() : null

    const key = headers['sec-websocket-key']
    if (!key || !/websocket/i.test(headers.upgrade || '')) {
      this.socket.end('HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\n\r\nThis is a ClassiCube server. Connect with the game client.\r\n')
      return false
    }

    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64')
    const lines = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`
    ]
    if (headers['sec-websocket-protocol']) lines.push('Sec-WebSocket-Protocol: ClassiCube')
    this.socket.write(lines.join('\r\n') + '\r\n\r\n')
    this.open = true
    if (rest.length) this.receive(rest)
    return true
  }

  receive (data) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, data]) : data
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0]
      const b1 = this.buffer[1]
      const fin = (b0 & 0x80) !== 0
      const opcode = b0 & 0x0F
      const masked = (b1 & 0x80) !== 0
      let len = b1 & 0x7F
      let o = 2
      if (len === 126) {
        if (this.buffer.length < 4) return
        len = this.buffer.readUInt16BE(2); o = 4
      } else if (len === 127) {
        if (this.buffer.length < 10) return
        const big = this.buffer.readBigUInt64BE(2)
        if (big > 1048576n) return this.close(1009)
        len = Number(big); o = 10
      }
      const maskLen = masked ? 4 : 0
      if (this.buffer.length < o + maskLen + len) return
      const mask = masked ? this.buffer.subarray(o, o + 4) : null
      o += maskLen
      const payload = Buffer.from(this.buffer.subarray(o, o + len))
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]
      this.buffer = this.buffer.subarray(o + len)

      switch (opcode) {
        case 0x0: // continuation
        case 0x1: // text
        case 0x2: // binary
          this.fragments.push(payload)
          if (fin) {
            const msg = Buffer.concat(this.fragments)
            this.fragments = []
            this.emit('data', msg)
          }
          break
        case 0x8: this.close(1000); return
        case 0x9: this.sendFrame(0xA, payload); break
        case 0xA: break
        default: this.close(1002); return
      }
    }
  }

  sendFrame (opcode, payload) {
    if (this.socket.destroyed) return
    const len = payload.length
    let header
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len])
    } else if (len < 65536) {
      header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2)
    }
    this.socket.write(Buffer.concat([header, payload]))
  }

  write (buf) { this.sendFrame(0x2, buf) }

  close (code = 1000) {
    if (this.closed) return
    this.closed = true
    const payload = Buffer.alloc(2)
    payload.writeUInt16BE(code)
    this.sendFrame(0x8, payload)
    this.socket.end()
  }
}

module.exports = { WebSocketTransport }
