'use strict'

// Compatibility with clients other than ClassiCube. They must never receive a packet from an
// extension they did not ask for, or they disconnect with "unknown packet".

const test = require('node:test')
const assert = require('node:assert/strict')

const { startServer, sleep } = require('./helpers/server')
const { TestClient } = require('./helpers/client')

const CLASSIC_PACKETS = ['serverIdentification', 'ping', 'levelInitialize', 'levelDataChunk', 'levelFinalize', 'setBlock',
  'spawnPlayer', 'teleport', 'posAndOrientUpdate', 'posUpdate', 'orientUpdate', 'despawnPlayer', 'message', 'disconnect', 'updateUserType']

// ViaLegacy (used by ViaFabricPlus) only implements these CPE extensions, see
// ClassicProtocolExtension.java in https://github.com/ViaVersion/ViaLegacy
const VIALEGACY_EXTENSIONS = [['CustomBlocks', 1], ['BlockPermissions', 1], ['HackControl', 1], ['EmoteFix', 1], ['LongerMessages', 1],
  ['FullCP437', 1], ['BulkBlockUpdate', 1], ['TwoWayPing', 1], ['InstantMOTD', 1]]
const VIALEGACY_PACKETS = [...CLASSIC_PACKETS, 'extInfo', 'extEntry', 'customBlockSupportLevel', 'hackControl', 'setBlockPermission',
  'bulkBlockUpdate', 'twoWayPing']

async function join (server, name, opts) {
  const c = new TestClient({ port: server.port, name, ...opts })
  await c.connect()
  await c.waitFor('levelFinalize')
  await c.waitFor(p => p.name === 'spawnPlayer' && p.id === -1)
  return c
}

async function command (client, cmd) {
  client.chat(cmd)
  await sleep(150)
}

// Runs through features that normally use CPE packets
async function exercise (server, owner, other) {
  const commands = [
    '/newlvl second 64 32 64 flat', '/goto second', '/env sky ff0000', '/weather rain', '/texture https://example.com/t.zip',
    '/model zombie', '/skin Notch', '/reach 10', '/fly', '/hold 20', '/nick Tester', '/color c', '/title Boss',
    '/gb create 70 Glowstone', '/effect sparkle', '/cinematic on', '/blocklist open',
    '/bot add Guide', '/zone add test', '/goto main', '/tp Other', '/afk', '/me waves', '/announce Hello', '/say hi',
    '/msg Other hi', '/modelscale 2', '/entityrot 0 0 45'
  ]
  for (const cmd of commands) await command(owner, cmd)
  // place and draw so block changes go out to both clients
  owner.send('setBlock', { x: 5, y: 16, z: 5, mode: 1, block: 1 })
  await command(owner, '/cuboid 1')
  owner.send('setBlock', { x: 2, y: 20, z: 2, mode: 1, block: 1 })
  owner.send('setBlock', { x: 4, y: 22, z: 4, mode: 1, block: 1 })
  await sleep(300)
  server.levels.main.setBlock(10, 20, 10, 70)
  server.levels.main.setBlock(11, 20, 11, 60)
  other.chat('hello from the other side')
  await sleep(500)
}

function unexpected (client, allowed) {
  return [...new Set(client.received.map(p => p.name))].filter(n => !allowed.includes(n))
}

test('ViaFabricPlus (ViaLegacy CPE) only gets packets it understands', async (t) => {
  const { server } = await startServer({ owners: ['Owner'] })
  t.after(() => server.stop())
  const owner = await join(server, 'Owner', { extensions: VIALEGACY_EXTENSIONS })
  const other = await join(server, 'Other', { extensions: VIALEGACY_EXTENSIONS })
  assert.deepEqual([...server.findPlayerExact('Owner').extensions.keys()].sort(), VIALEGACY_EXTENSIONS.map(e => e[0]).sort())

  await exercise(server, owner, other)

  assert.deepEqual(unexpected(owner, VIALEGACY_PACKETS), [])
  assert.deepEqual(unexpected(other, VIALEGACY_PACKETS), [])
  assert.ok(!owner.received.some(p => p.name === 'disconnect'))
  // custom block 70 reaches it as its fallback, CPE block 60 as itself (CustomBlocks level 1)
  const ids = owner.received.filter(p => p.name === 'setBlock').map(p => p.block)
  assert.ok(!ids.some(b => b > 65), 'no block ids above the CPE range')
  assert.ok(ids.includes(60))
})

test('vanilla Classic 0.30 (BetaCraft) only gets classic packets', async (t) => {
  const { server } = await startServer({ owners: ['Owner'] })
  t.after(() => server.stop())
  const owner = await join(server, 'Owner', { cpe: false })
  const other = await join(server, 'Other', { cpe: false })

  await exercise(server, owner, other)

  assert.deepEqual(unexpected(owner, CLASSIC_PACKETS), [])
  assert.deepEqual(unexpected(other, CLASSIC_PACKETS), [])
  assert.ok(!owner.received.some(p => p.name === 'disconnect'))
  const ids = owner.received.filter(p => p.name === 'setBlock').map(p => p.block)
  assert.ok(!ids.some(b => b > 49), 'no block ids above the classic range')
})
