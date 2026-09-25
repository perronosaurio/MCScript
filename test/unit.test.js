'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const cp437 = require('../lib/protocol/cp437')
const packets = require('../lib/protocol/packets')
const text = require('../lib/util/text')
const nbt = require('../lib/util/nbt')
const Blocks = require('../lib/blocks')
const { EventBus } = require('../lib/events')
const { Ranks } = require('../lib/ranks')

test('cp437 table has 256 entries and round-trips', () => {
  assert.equal(cp437.LOW.length, 32)
  assert.equal(cp437.HIGH.length, 128)
  const s = 'Hola señor ☺ ░▒▓ ²'
  assert.equal(cp437.decode(cp437.encode(s)), s)
  // without FullCP437 only ASCII is sent
  assert.equal(cp437.decode(cp437.encode('señor', false)), 'se?or')
})

// Packet sizes as read by the ClassiCube client (src/Protocol.c) for the versions we advertise
test('server packet sizes match the ClassiCube client', () => {
  const expected = {
    serverIdentification: 131,
    ping: 1,
    levelInitialize: 1,
    levelInitializeFast: 5,
    levelDataChunk: 1028,
    levelFinalize: 7,
    setBlock: 8,
    spawnPlayer: 74,
    teleport: 10,
    posAndOrientUpdate: 7,
    posUpdate: 5,
    orientUpdate: 4,
    despawnPlayer: 2,
    message: 66,
    disconnect: 65,
    updateUserType: 2,
    extInfo: 67,
    extEntry: 69,
    setClickDistance: 3,
    customBlockSupportLevel: 2,
    holdThis: 3,
    setTextHotKey: 134,
    extAddPlayerName: 196,
    extRemovePlayerName: 3,
    envSetColor: 8,
    makeSelection: 86,
    removeSelection: 2,
    setBlockPermission: 4,
    changeModel: 66,
    envSetWeatherType: 2,
    hackControl: 8,
    extAddEntity2: 138,
    defineBlock: 80,
    removeBlockDefinition: 2,
    defineBlockExt: 88,
    bulkBlockUpdate: 1282,
    setTextColor: 6,
    setMapEnvUrl: 65,
    setMapEnvProperty: 6,
    setEntityProperty: 7,
    twoWayPing: 4,
    setInventoryOrder: 3,
    setHotbar: 3,
    setSpawnpoint: 9,
    velocityControl: 16,
    lightingMode: 3
  }
  for (const [name, size] of Object.entries(expected)) {
    assert.equal(packets.SERVER[name].size, size, name)
    assert.equal(packets.encode(name, {}).length, size, name)
  }
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(packets.SERVER).sort())
})

// With ExtendedBlocks / ExtEntityPositions the ClassiCube client grows these packets (Protocol.c, CPE_ExtEntry)
test('packet sizes change with ExtendedBlocks and ExtEntityPositions', () => {
  const eb = { extBlocks: true }
  const grow = { setBlock: 1, holdThis: 1, setBlockPermission: 1, defineBlock: 1, removeBlockDefinition: 1, defineBlockExt: 1, setInventoryOrder: 2, bulkBlockUpdate: 64, setHotbar: 1 }
  for (const [name, extra] of Object.entries(grow)) {
    assert.equal(packets.sizeOf(packets.SERVER[name], eb), packets.SERVER[name].size + extra, name)
  }
  const ep = { extPos: true }
  for (const name of ['teleport', 'spawnPlayer', 'extAddEntity2', 'setSpawnpoint']) {
    assert.equal(packets.sizeOf(packets.SERVER[name], ep), packets.SERVER[name].size + 6, name)
  }
  // client -> server
  assert.equal(packets.sizeOf(packets.CLIENT[0x05], eb), 10)
  assert.equal(packets.sizeOf(packets.CLIENT[0x08], { extBlocks: true, extPos: true }), 17)
  const buf = packets.encode('setBlock', { x: 1, y: 2, z: 3, block: 700 }, eb)
  assert.equal(buf.readUInt16BE(7), 700)
})

test('client packet sizes', () => {
  const expected = { 0x00: 131, 0x05: 9, 0x08: 10, 0x0d: 66, 0x10: 67, 0x11: 69, 0x13: 2, 0x22: 15, 0x2b: 4 }
  for (const [id, size] of Object.entries(expected)) assert.equal(packets.CLIENT[id].size, size)
})

test('packet encode/decode', () => {
  const buf = packets.encode('message', { type: -1, message: 'hi' })
  assert.equal(buf[0], 0x0d)
  assert.equal(buf.readInt8(1), -1)
  assert.equal(packets.readString(buf, 2), 'hi')
  const id = Buffer.alloc(131)
  id[0] = 0; id[1] = 7
  packets.writeString(id, 2, 'Steve'); packets.writeString(id, 66, 'abc'); id[130] = 0x42
  const p = packets.decode(0, id)
  assert.deepEqual(p, { name: 'identification', protocolVersion: 7, username: 'Steve', key: 'abc', padding: 0x42 })
})

test('text wrapping keeps colors and never ends with a color code', () => {
  const lines = text.wrap('&aThis is a very long message that should be split into more than one line of chat text &cred', 64)
  assert.ok(lines.length >= 2)
  for (const l of lines) {
    assert.ok(l.length <= 64)
    assert.ok(!/&.?$/.test(l))
  }
  assert.ok(lines[1].startsWith('> &a'))
  assert.equal(text.sanitize('bad & trailing &'), 'bad  trailing ')
  assert.equal(text.convertPercentCodes('%chello %zworld'), '&chello %zworld')
})

test('durations', () => {
  assert.equal(text.parseDuration('10m'), 600000)
  assert.equal(text.parseDuration('1d12h'), 129600000)
  assert.equal(text.parseDuration('90'), 90000)
  assert.equal(text.parseDuration('spam'), null)
  assert.equal(text.formatDuration(3723000), '1h 2m 3s')
})

test('nbt round trip', () => {
  const { t } = nbt
  const data = { A: t.byte(-3), B: t.short(300), C: t.int(-70000), D: t.long(123456789012), E: t.float(1.5), F: t.string('héllo'), G: t.bytes(Buffer.from([1, 2, 3])), H: t.compound({ X: t.short(1) }) }
  const out = nbt.read(nbt.write('Root', data))
  assert.equal(out.name, 'Root')
  const s = nbt.simplify(out.value)
  assert.equal(s.A, -3); assert.equal(s.B, 300); assert.equal(s.C, -70000); assert.equal(s.D, 123456789012n)
  assert.equal(s.E, 1.5); assert.equal(s.F, 'héllo'); assert.deepEqual([...s.G], [1, 2, 3]); assert.equal(s.H.X, 1)
})

test('block parsing and definitions', () => {
  assert.equal(Blocks.parse('stone'), 1)
  assert.equal(Blocks.parse('Still Water'), 9)
  assert.equal(Blocks.parse('65'), 65)
  assert.equal(Blocks.parse('70'), null)
  assert.equal(Blocks.parse('70', id => id === 70 ? { name: 'Lamp' } : null), 70)
  assert.equal(Blocks.parse('lamp', id => id === 70 ? { name: 'Lamp' } : null), 70)
  const [name, data] = Blocks.definitionPacket({ id: 70, name: 'Lamp', speed: 1 }, true)
  assert.equal(name, 'defineBlockExt')
  assert.equal(data.speed, 128)
  assert.equal(packets.encode(name, data).length, 88)
  const [spriteName] = Blocks.definitionPacket({ ...Blocks.coreDefinition(37), id: 90 }, true)
  assert.equal(spriteName, 'defineBlock')
})

test('event bus priorities and cancelling', () => {
  const bus = new EventBus(null)
  const order = []
  bus.on('x', () => order.push('low'), { priority: 'low' })
  bus.on('x', (ev) => { order.push('high'); ev.cancel('no') }, { priority: 'high' })
  bus.on('x', () => order.push('normal'))
  bus.on('x', (ev) => order.push('monitor:' + ev.cancelled), { priority: 'monitor', owner: 'p' })
  const ev = bus.fire('x', {})
  assert.deepEqual(order, ['high', 'monitor:true'])
  assert.equal(ev.cancelReason, 'no')
  bus.removeOwner('p')
  order.length = 0
  bus.fire('x', {})
  assert.deepEqual(order, ['high'])
})

test('ranks', () => {
  const ranks = new Ranks(null, 'Guest')
  assert.equal(ranks.default.name, 'Guest')
  assert.equal(ranks.get('operator').permission, 80)
  assert.equal(ranks.get(85).name, 'Operator')
  assert.equal(ranks.permissionOf(null), 0)
  assert.equal(ranks.next('Guest').name, 'Builder')
  assert.equal(ranks.highest.name, 'Owner')
})

test('SQLite player database', { skip: (() => { try { require('node:sqlite'); return false } catch (e) { return true } })() }, () => {
  const fs = require('fs'); const os = require('os'); const path = require('path')
  const { SqlitePlayerDB } = require('../lib/storage/player-db')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcscript-sqlite-'))
  fs.writeFileSync(path.join(dir, 'players.json'), JSON.stringify({ old: { name: 'Old', rank: 'Builder', ips: [] } }))
  let db = new SqlitePlayerDB(path.join(dir, 'players.db'), { importFrom: path.join(dir, 'players.json') })
  assert.equal(db.get('OLD').rank, 'Builder') // imported from players.json
  const r = db.getOrCreate('Steve_1')
  r.blocksPlaced = 42
  r.ips.push('1.2.3.4')
  assert.equal(db.find('stev').name, 'Steve_1')
  assert.equal(db.find('st%'), null)
  db.close()
  db = new SqlitePlayerDB(path.join(dir, 'players.db'))
  assert.equal(db.get('steve_1').blocksPlaced, 42)
  assert.deepEqual(db.get('steve_1').ips, ['1.2.3.4'])
  assert.equal(db.all().length, 2)
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})
