'use strict'

// Append-only log of block changes, one binary file per level:
//   data/plugins/core-building/history/<level>.log
// Each record is 14 bytes: index u32, from u16, to u16, time (seconds) u32, player name id u16.
// Player names are stored once in names.json.

const fs = require('fs')
const path = require('path')

const RECORD = 14

class BlockLog {
  constructor (dir, { maxBytes = 64 * 1024 * 1024 } = {}) {
    this.dir = dir
    this.maxBytes = maxBytes
    this.buffers = new Map() // level -> [Buffer]
    fs.mkdirSync(dir, { recursive: true })
    this.namesFile = path.join(dir, 'names.json')
    this.names = fs.existsSync(this.namesFile) ? JSON.parse(fs.readFileSync(this.namesFile, 'utf8')) : []
    this.nameIds = new Map(this.names.map((n, i) => [n, i]))
    this.namesDirty = false
  }

  file (level) { return path.join(this.dir, `${level}.log`) }

  nameId (name) {
    let id = this.nameIds.get(name)
    if (id === undefined) {
      id = this.names.length
      if (id > 0xFFFF) id = 0xFFFF // extremely unlikely: reuse the last slot
      else { this.names.push(name); this.nameIds.set(name, id); this.namesDirty = true }
    }
    return id
  }

  // changes: [[index, from, to], ...]
  append (level, name, changes, time = Date.now()) {
    if (!changes.length) return
    const id = this.nameId(name)
    const secs = Math.floor(time / 1000)
    const buf = Buffer.alloc(changes.length * RECORD)
    changes.forEach(([index, from, to], n) => {
      const o = n * RECORD
      buf.writeUInt32LE(index, o)
      buf.writeUInt16LE(from, o + 4)
      buf.writeUInt16LE(to, o + 6)
      buf.writeUInt32LE(secs, o + 8)
      buf.writeUInt16LE(id, o + 12)
    })
    const list = this.buffers.get(level) || []
    list.push(buf)
    this.buffers.set(level, list)
  }

  flush () {
    if (this.namesDirty) {
      fs.writeFileSync(this.namesFile, JSON.stringify(this.names))
      this.namesDirty = false
    }
    for (const [level, list] of this.buffers) {
      const file = this.file(level)
      fs.appendFileSync(file, Buffer.concat(list))
      this.buffers.delete(level)
      if (fs.statSync(file).size > this.maxBytes) this._compact(file)
    }
  }

  // Keeps the newest half of an oversized log
  _compact (file) {
    const data = fs.readFileSync(file)
    const keep = Math.floor(data.length / 2 / RECORD) * RECORD
    fs.writeFileSync(file + '.tmp', data.subarray(data.length - keep))
    fs.renameSync(file + '.tmp', file)
  }

  _decode (buf, o) {
    return {
      index: buf.readUInt32LE(o),
      from: buf.readUInt16LE(o + 4),
      to: buf.readUInt16LE(o + 6),
      time: buf.readUInt32LE(o + 8) * 1000,
      name: this.names[buf.readUInt16LE(o + 12)] || '?'
    }
  }

  _all (level) {
    const file = this.file(level)
    const parts = []
    if (fs.existsSync(file)) parts.push(fs.readFileSync(file))
    for (const b of this.buffers.get(level) || []) parts.push(b)
    return Buffer.concat(parts)
  }

  // Newest `max` records, oldest first
  recent (level, max) {
    const buf = this._all(level)
    const count = Math.floor(buf.length / RECORD)
    const out = []
    for (let n = Math.max(0, count - max); n < count; n++) out.push(this._decode(buf, n * RECORD))
    return out
  }

  // Records matching a filter, newest first
  search (level, { name = null, since = 0 } = {}) {
    const buf = this._all(level)
    const lower = name && name.toLowerCase()
    const out = []
    for (let o = buf.length - RECORD; o >= 0; o -= RECORD) {
      const time = buf.readUInt32LE(o + 8) * 1000
      if (time < since) break
      const r = this._decode(buf, o)
      if (lower && r.name.toLowerCase() !== lower) continue
      out.push(r)
    }
    return out
  }
}

module.exports = { BlockLog, RECORD }
