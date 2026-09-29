'use strict'

// Minimal big-endian NBT reader/writer (used by the ClassicWorld .cw format).
// Values are represented as { type, value } so they round-trip with the right tag types.

const TAG = {
  end: 0,
  byte: 1,
  short: 2,
  int: 3,
  long: 4,
  float: 5,
  double: 6,
  byteArray: 7,
  string: 8,
  list: 9,
  compound: 10,
  intArray: 11,
  longArray: 12
}
const TAG_NAMES = Object.fromEntries(Object.entries(TAG).map(([k, v]) => [v, k]))

class Reader {
  constructor (buf) { this.buf = buf; this.o = 0 }
  u8 () { return this.buf.readUInt8(this.o++) }
  i8 () { return this.buf.readInt8(this.o++) }
  i16 () { const v = this.buf.readInt16BE(this.o); this.o += 2; return v }
  u16 () { const v = this.buf.readUInt16BE(this.o); this.o += 2; return v }
  i32 () { const v = this.buf.readInt32BE(this.o); this.o += 4; return v }
  i64 () { const v = this.buf.readBigInt64BE(this.o); this.o += 8; return v }
  f32 () { const v = this.buf.readFloatBE(this.o); this.o += 4; return v }
  f64 () { const v = this.buf.readDoubleBE(this.o); this.o += 8; return v }
  str () { const n = this.u16(); const s = this.buf.toString('utf8', this.o, this.o + n); this.o += n; return s }

  payload (type) {
    switch (type) {
      case TAG.byte: return this.i8()
      case TAG.short: return this.i16()
      case TAG.int: return this.i32()
      case TAG.long: return this.i64()
      case TAG.float: return this.f32()
      case TAG.double: return this.f64()
      case TAG.byteArray: {
        const n = this.i32()
        const v = Buffer.from(this.buf.subarray(this.o, this.o + n))
        this.o += n
        return v
      }
      case TAG.string: return this.str()
      case TAG.list: {
        const itemType = this.u8()
        const n = this.i32()
        const items = []
        for (let i = 0; i < n; i++) items.push(this.payload(itemType))
        return { itemType: TAG_NAMES[itemType], items }
      }
      case TAG.compound: {
        const out = {}
        for (;;) {
          const t = this.u8()
          if (t === TAG.end) break
          const name = this.str()
          out[name] = { type: TAG_NAMES[t], value: this.payload(t) }
        }
        return out
      }
      case TAG.intArray: {
        const n = this.i32(); const a = []
        for (let i = 0; i < n; i++) a.push(this.i32())
        return a
      }
      case TAG.longArray: {
        const n = this.i32(); const a = []
        for (let i = 0; i < n; i++) a.push(this.i64())
        return a
      }
      default: throw new Error(`Unknown NBT tag ${type}`)
    }
  }
}

function read (buf) {
  const r = new Reader(buf)
  const type = r.u8()
  if (type !== TAG.compound) throw new Error('NBT root must be a compound')
  const name = r.str()
  return { name, value: r.payload(type) }
}

class Writer {
  constructor () { this.parts = [] }
  push (b) { this.parts.push(b) }
  u8 (v) { const b = Buffer.alloc(1); b.writeUInt8(v & 0xFF); this.push(b) }
  i8 (v) { const b = Buffer.alloc(1); b.writeInt8(v); this.push(b) }
  i16 (v) { const b = Buffer.alloc(2); b.writeInt16BE(v); this.push(b) }
  u16 (v) { const b = Buffer.alloc(2); b.writeUInt16BE(v); this.push(b) }
  i32 (v) { const b = Buffer.alloc(4); b.writeInt32BE(v); this.push(b) }
  i64 (v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); this.push(b) }
  f32 (v) { const b = Buffer.alloc(4); b.writeFloatBE(v); this.push(b) }
  f64 (v) { const b = Buffer.alloc(8); b.writeDoubleBE(v); this.push(b) }
  str (s) { const b = Buffer.from(String(s), 'utf8'); this.u16(b.length); this.push(b) }

  payload (type, value) {
    switch (TAG[type]) {
      case TAG.byte: return this.i8(value)
      case TAG.short: return this.i16(value)
      case TAG.int: return this.i32(value)
      case TAG.long: return this.i64(value)
      case TAG.float: return this.f32(value)
      case TAG.double: return this.f64(value)
      case TAG.byteArray: this.i32(value.length); return this.push(Buffer.from(value))
      case TAG.string: return this.str(value)
      case TAG.list:
        this.u8(TAG[value.itemType])
        this.i32(value.items.length)
        for (const item of value.items) this.payload(value.itemType, item)
        return
      case TAG.compound:
        for (const [name, tag] of Object.entries(value)) {
          if (!tag || tag.value === undefined || tag.value === null) continue
          this.u8(TAG[tag.type])
          this.str(name)
          this.payload(tag.type, tag.value)
        }
        return this.u8(TAG.end)
      case TAG.intArray: this.i32(value.length); for (const v of value) this.i32(v); return
      case TAG.longArray: this.i32(value.length); for (const v of value) this.i64(v); return
      default: throw new Error(`Unknown NBT tag type ${type}`)
    }
  }
}

function write (name, compound) {
  const w = new Writer()
  w.u8(TAG.compound)
  w.str(name)
  w.payload('compound', compound)
  return Buffer.concat(w.parts)
}

// helpers to build tags
const t = {
  byte: v => ({ type: 'byte', value: v }),
  short: v => ({ type: 'short', value: v }),
  int: v => ({ type: 'int', value: v }),
  long: v => ({ type: 'long', value: v }),
  float: v => ({ type: 'float', value: v }),
  string: v => ({ type: 'string', value: v }),
  bytes: v => ({ type: 'byteArray', value: v }),
  compound: v => ({ type: 'compound', value: v })
}

// Unwrap a compound into plain JS values (recursively)
function simplify (compound) {
  const out = {}
  for (const [k, tag] of Object.entries(compound)) {
    out[k] = tag.type === 'compound' ? simplify(tag.value) : tag.value
  }
  return out
}

module.exports = { read, write, t, simplify, TAG }
