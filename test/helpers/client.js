'use strict'

// A tiny scripted Classic/CPE client used by the integration tests.

const net = require('net')
const zlib = require('zlib')
const { EventEmitter } = require('events')
const packets = require('../../lib/protocol/packets')

const CLIENT_OUT = {
  identification: packets.CLIENT[0x00],
  setBlock: packets.CLIENT[0x05],
  position: packets.CLIENT[0x08],
  message: packets.CLIENT[0x0d],
  extInfo: packets.CLIENT[0x10],
  extEntry: packets.CLIENT[0x11],
  customBlockSupportLevel: packets.CLIENT[0x13],
  playerClicked: packets.CLIENT[0x22],
  twoWayPing: packets.CLIENT[0x2b],
  pluginMessage: packets.CLIENT[0x35],
  notifyAction: packets.CLIENT[0x39]
}

const resolve = (type, opts) => type === 'blk' ? (opts.extBlocks ? 'u16' : 'u8') : type === 'pos' ? (opts.extPos ? 'i32' : 'i16') : type

function encodeClient (name, data, opts = {}) {
  const def = CLIENT_OUT[name]
  const buf = Buffer.alloc(packets.sizeOf(def, opts))
  buf[0] = def.id
  let o = 1
  for (const [field, rawType] of def.fields) {
    const type = resolve(rawType, opts)
    const v = data[field] ?? 0
    if (type === 'u8') { buf.writeUInt8(v & 255, o); o += 1 } else if (type === 'i8') { buf.writeInt8(v, o); o += 1 } else if (type === 'u16') { buf.writeUInt16BE(v, o); o += 2 } else if (type === 'i16') { buf.writeInt16BE(v, o); o += 2 } else if (type === 'i32') { buf.writeInt32BE(v, o); o += 4 } else if (type === 'str') { packets.writeString(buf, o, v, true); o += 64 } else if (type.startsWith('bytes:')) { const n = Number(type.slice(6)); if (v) Buffer.from(v).copy(buf, o); o += n }
  }
  return buf
}

// server packet id -> list of defs (levelInitialize has two variants)
function serverDefs (fastMap) {
  const byId = {}
  for (const [name, def] of Object.entries(packets.SERVER)) {
    if (name === 'levelInitializeFast' && !fastMap) continue
    if (name === 'levelInitialize' && fastMap) continue
    byId[def.id] = { name, ...def }
  }
  return byId
}

function decodeServer (def, buf, opts = {}) {
  const out = { name: def.name }
  let o = 1
  for (const [field, rawType] of def.fields) {
    const type = resolve(rawType, opts)
    if (type === 'u8') { out[field] = buf.readUInt8(o); o += 1 } else if (type === 'i8') { out[field] = buf.readInt8(o); o += 1 } else if (type === 'u16') { out[field] = buf.readUInt16BE(o); o += 2 } else if (type === 'i16') { out[field] = buf.readInt16BE(o); o += 2 } else if (type === 'i32') { out[field] = buf.readInt32BE(o); o += 4 } else if (type === 'f32') { out[field] = buf.readFloatBE(o); o += 4 } else if (type === 'str') { out[field] = packets.readString(buf, o); o += 64 } else if (type.startsWith('xbytes:')) {
      const n = opts.extBlocks ? Number(type.slice(7)) : 0; out[field] = Buffer.from(buf.subarray(o, o + n)); o += n
    } else {
      const n = Number(type.slice(6)); out[field] = Buffer.from(buf.subarray(o, o + n)); o += n
    }
  }
  return out
}

class TestClient extends EventEmitter {
  constructor ({ port, name = 'Tester', cpe = true, extensions = null, key = '' }) {
    super()
    this.port = port
    this.name = name
    this.cpe = cpe
    this.key = key
    // by default, pretend to support everything the server supports
    this.extensions = extensions || Object.entries(packets.EXTENSIONS)
    this.buffer = Buffer.alloc(0)
    this.received = []
    this.cursor = 0
    this.messages = []
    this.levelChunks = []
    this.level = null
    this.entities = new Map()
    this.blockChanges = []
    this.defs = serverDefs(false)
    this.opts = { extBlocks: false, extPos: false }
  }

  connect () {
    return new Promise((resolve, reject) => {
      this.socket = net.connect(this.port, '127.0.0.1', () => {
        this.send('identification', { protocolVersion: 7, username: this.name, key: this.key, padding: this.cpe ? 0x42 : 0 })
        resolve()
      })
      this.socket.on('error', reject)
      this.socket.on('data', d => this._onData(d))
      this.socket.on('close', () => this.emit('close'))
    })
  }

  send (name, data = {}) { this.socket.write(encodeClient(name, data, this.opts)) }

  chat (msg) { this.send('message', { partial: 0, message: msg }) }

  _onData (data) {
    this.buffer = Buffer.concat([this.buffer, data])
    while (this.buffer.length) {
      const def = this.defs[this.buffer[0]]
      if (!def) throw new Error(`Test client: unknown server packet ${this.buffer[0]}`)
      const size = packets.sizeOf(def, this.opts)
      if (this.buffer.length < size) return
      const p = decodeServer(def, this.buffer.subarray(0, size), this.opts)
      this.buffer = this.buffer.subarray(size)
      this._handle(p)
    }
  }

  _handle (p) {
    this.received.push(p)
    switch (p.name) {
      case 'extInfo':
        this.serverExtCount = p.count
        break
      case 'extEntry':
        if (--this.serverExtCount === 0) {
          this.send('extInfo', { appName: 'TestClient', count: this.extensions.length })
          for (const [extName, version] of this.extensions) this.send('extEntry', { extName, version })
          const fast = this.extensions.some(([n]) => n === 'FastMap')
          this.defs = serverDefs(fast)
          this.fastMap = fast
          this.opts = {
            extBlocks: this.extensions.some(([n]) => n === 'ExtendedBlocks'),
            extPos: this.extensions.some(([n]) => n === 'ExtEntityPositions')
          }
        }
        break
      case 'customBlockSupportLevel':
        this.send('customBlockSupportLevel', { level: 1 })
        break
      case 'levelDataChunk':
        if (this.opts.extBlocks && p.percent) (this.upperChunks = this.upperChunks || []).push(p.data.subarray(0, p.length))
        else this.levelChunks.push(p.data.subarray(0, p.length))
        break
      case 'levelFinalize': {
        const inflate = data => this.fastMap ? zlib.inflateRawSync(data) : zlib.gunzipSync(data).subarray(4)
        const raw = inflate(Buffer.concat(this.levelChunks))
        const upper = this.upperChunks ? inflate(Buffer.concat(this.upperChunks)) : null
        this.levelChunks = []
        this.upperChunks = null
        this.level = { width: p.x, height: p.y, length: p.z, blocks: raw, upper }
        this.emit('level', this.level)
        break
      }
      case 'message':
        this.messages.push(p.message)
        this.emit('message', p.message)
        break
      case 'spawnPlayer':
      case 'extAddEntity2':
        this.entities.set(p.id, p)
        this.emit('spawn', p)
        break
      case 'despawnPlayer':
        this.entities.delete(p.id)
        this.emit('despawn', p)
        break
      case 'setBlock':
        this.blockChanges.push(p)
        if (this.level) this.level.blocks[(p.y * this.level.length + p.z) * this.level.width + p.x] = p.block
        break
      case 'bulkBlockUpdate':
        for (let i = 0; i <= p.count; i++) {
          const index = p.indices.readInt32BE(i * 4)
          if (this.level) this.level.blocks[index] = p.blocks[i]
        }
        this.blockChanges.push(p)
        break
      case 'disconnect':
        this.kickReason = p.reason
        this.emit('kick', p.reason)
        break
    }
    this.emit('packet', p)
  }

  waitFor (predicate, timeout = 3000) {
    if (typeof predicate === 'string') { const name = predicate; predicate = p => p.name === name }
    const existing = this.received.slice(this.cursor).find(predicate)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.off('packet', handler); reject(new Error('Timed out waiting for packet')) }, timeout)
      const handler = p => { if (predicate(p)) { clearTimeout(timer); this.off('packet', handler); resolve(p) } }
      this.on('packet', handler)
    })
  }

  waitForMessage (re, timeout = 3000) {
    return this.waitFor(p => p.name === 'message' && re.test(p.message), timeout)
  }

  // Only packets received after mark() are considered by waitFor()
  mark () { this.cursor = this.received.length }

  close () { this.socket.destroy() }
}

module.exports = { TestClient }
