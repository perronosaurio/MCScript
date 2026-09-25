'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const { Level } = require('../lib/level/level')
const { generators } = require('../lib/level/generators')

test('block indexing follows the classic x + width * (z + length * y) order', () => {
  const level = new Level({ name: 't', width: 4, height: 3, length: 5 })
  level.setBlockRaw(1, 2, 3, 7)
  assert.equal(level.blocks[1 + 4 * (3 + 5 * 2)], 7)
  assert.deepEqual(level.unpack(level.index(1, 2, 3)), { x: 1, y: 2, z: 3 })
  assert.equal(level.getBlock(10, 0, 0), 0)
})

test('ClassicWorld save/load keeps blocks, env, custom blocks and plugin metadata', () => {
  const level = new Level({ name: 'roundtrip', width: 16, height: 16, length: 32 })
  generators.flat.generate(level)
  level.setBlockRaw(3, 9, 20, 45)
  level.env.skyColor = 'ff0000'
  level.env.texture = 'https://example.com/pack.zip'
  level.env.weather = 2
  level.blockDefs[70] = { id: 70, name: 'Lamp', fullBright: true }
  level.meta.zones = [{ name: 'z' }]
  level.buildRank = 'Builder'
  level.spawn = { x: 5.5, y: 9, z: 6.5, yaw: 64, pitch: 0 }

  const copy = Level.fromCW(level.toCW(), 'roundtrip')
  assert.equal(copy.width, 16); assert.equal(copy.length, 32)
  assert.deepEqual(copy.blocks, level.blocks)
  assert.equal(copy.env.skyColor, 'ff0000')
  assert.equal(copy.env.texture, 'https://example.com/pack.zip')
  assert.equal(copy.env.weather, 2)
  assert.equal(copy.blockDefs[70].name, 'Lamp')
  assert.deepEqual(copy.meta.zones, [{ name: 'z' }])
  assert.equal(copy.buildRank, 'Builder')
  assert.equal(copy.spawn.x, 5.5); assert.equal(copy.spawn.yaw, 64)
})

test('.cw from other software: env and block definitions are read from CPE metadata', () => {
  const level = new Level({ name: 'x', width: 16, height: 16, length: 16 })
  level.env.fogColor = '112233'
  level.env.sideBlock = 12
  level.blockDefs[100] = { id: 100, name: 'Foreign', collide: 0, textures: { top: 5, bottom: 6, left: 7, right: 7, front: 7, back: 7 } }
  // Drop our own MCScript metadata to simulate a map from ClassiCube/MCGalaxy
  const nbt = require('../lib/util/nbt')
  const tree = nbt.read(zlib.gunzipSync(level.toCW()))
  delete tree.value.Metadata.value.MCScript
  const foreign = Level.fromCW(zlib.gzipSync(nbt.write('ClassicWorld', tree.value)), 'x')
  assert.equal(foreign.env.fogColor, '112233')
  assert.equal(foreign.env.sideBlock, 12)
  assert.equal(foreign.blockDefs[100].name, 'Foreign')
  assert.equal(foreign.blockDefs[100].collide, 0)
  assert.equal(foreign.blockDefs[100].textures.top, 5)
})

test('MCGalaxy .lvl import', () => {
  const w = 8; const h = 4; const l = 6
  const header = Buffer.alloc(18)
  header.writeUInt16LE(1874, 0)
  header.writeUInt16LE(w, 2); header.writeUInt16LE(l, 4); header.writeUInt16LE(h, 6)
  header.writeUInt16LE(2, 8); header.writeUInt16LE(3, 10); header.writeUInt16LE(1, 12)
  const blocks = Buffer.alloc(w * h * l, 1)
  blocks[0] = 49
  blocks[1] = 110 // MCGalaxy physics block -> stone
  const level = Level.fromLvl(zlib.gzipSync(Buffer.concat([header, blocks])), 'imported')
  assert.equal(level.width, w); assert.equal(level.height, h); assert.equal(level.length, l)
  assert.equal(level.blocks[0], 49)
  assert.equal(level.blocks[1], 1)
  assert.equal(level.spawn.x, 2.5); assert.equal(level.spawn.z, 3.5)
  assert.equal(level.importWarnings.length, 1)
})

test('legacy MCScript level.dat import', { skip: !fs.existsSync(path.join(__dirname, '..', 'levels', 'level.dat')) }, () => {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'levels', 'level.dat'))
  const level = Level.fromLegacyDat(buf, 'main')
  assert.equal(level.volume, 256 * 64 * 256)
  // the old generator made a bedrock floor
  const floor = level.blocks.subarray(0, 256 * 256)
  assert.ok(floor.filter(b => b === 7).length > floor.length * 0.9)
})

test('generators produce valid levels', () => {
  for (const name of ['empty', 'flat', 'pixel', 'space', 'ocean', 'island', 'terrain']) {
    const level = new Level({ name, width: 64, height: 32, length: 64 })
    generators[name].generate(level, { seed: 1 })
    assert.ok(level.spawn.y >= 0 && level.spawn.y <= 34, name)
    assert.ok(level.blocks.some(b => b !== 0), name)
  }
  // same seed, same terrain
  const a = new Level({ name: 'a', width: 32, height: 32, length: 32 })
  const b = new Level({ name: 'b', width: 32, height: 32, length: 32 })
  generators.terrain.generate(a, { seed: 99 })
  generators.terrain.generate(b, { seed: 99 })
  assert.deepEqual(a.blocks, b.blocks)
})
