'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('net')
const crypto = require('crypto')

const { startServer, sleep } = require('./helpers/server')
const { TestClient } = require('./helpers/client')
const packets = require('../lib/protocol/packets')

async function join (server, name, opts = {}) {
  const c = new TestClient({ port: server.port, name, ...opts })
  await c.connect()
  await c.waitFor('levelFinalize')
  await c.waitFor(p => p.name === (c.cpe ? 'extAddEntity2' : 'spawnPlayer') && p.id === -1)
  return c
}

async function command (client, cmd, wait = 150) {
  client.mark()
  client.chat(cmd)
  await sleep(wait)
  return client.received.slice(client.cursor).filter(p => p.name === 'message').map(p => p.message).join('\n')
}

test('login, CPE negotiation and map transfer', async (t) => {
  const { server } = await startServer({ owners: ['Owner1'] })
  t.after(() => server.stop())

  const cpe = await join(server, 'Alice')
  assert.ok(cpe.received.some(p => p.name === 'extInfo'))
  assert.equal(cpe.level.width, 64)
  assert.equal(cpe.level.blocks.length, 64 * 32 * 64)
  assert.ok(cpe.received.some(p => p.name === 'levelInitializeFast'), 'FastMap used for CPE clients')
  assert.ok(cpe.received.some(p => p.name === 'envSetColor'))
  const player = server.findPlayerExact('Alice')
  assert.equal(player.customBlocksLevel, 1)
  assert.ok(player.supports('BlockDefinitionsExt', 2))

  const classic = await join(server, 'Bob', { cpe: false })
  assert.ok(!classic.received.some(p => p.name === 'extInfo'))
  assert.ok(classic.received.some(p => p.name === 'levelInitialize'))
  assert.equal(classic.level.blocks.length, 64 * 32 * 64)

  // they see each other
  await cpe.waitFor(p => p.name === 'extAddEntity2' && p.entityName.includes('Bob'))
  assert.ok([...classic.entities.values()].some(e => e.entityName.includes('Alice')))
  // tab list
  await cpe.waitFor(p => p.name === 'extAddPlayerName' && p.playerName === 'Bob')

  // duplicate login kicks the old session
  const again = new TestClient({ port: server.port, name: 'Bob', cpe: false })
  await again.connect()
  await classic.waitFor('disconnect')
  assert.match(classic.kickReason, /logged in as you/)
  again.close()
  cpe.close()
})

test('chat, colors and commands', async (t) => {
  const { server } = await startServer()
  t.after(() => server.stop())
  const a = await join(server, 'Alice')
  const b = await join(server, 'Bob')

  a.chat('hello %cthere')
  const msg = await b.waitForMessage(/hello/)
  assert.match(msg.message, /Alice&f: hello &cthere/)

  // long messages (LongerMessages) arrive in parts
  a.send('message', { partial: 1, message: 'x'.repeat(64) })
  a.send('message', { partial: 0, message: 'END' })
  await b.waitForMessage(/END/)

  assert.match(await command(a, '/nonexistent'), /Unknown command/)
  assert.match(await command(a, '/kick Bob'), /Only .*Operator/)
  assert.match(await command(a, '/help tp'), /\/tp <player>/)
  assert.match(await command(a, '/msg Bob secret'), /-> .*Bob/)
  await b.waitForMessage(/secret/)
  a.close(); b.close()
})

test('building: permissions, broadcast and CPE block fallback', async (t) => {
  const { server } = await startServer()
  t.after(() => server.stop())
  const a = await join(server, 'Alice')
  const b = await join(server, 'Bob', { cpe: false })
  const p = server.findPlayerExact('Alice').blockPos

  // place stone next to the player
  a.send('setBlock', { x: p.x + 1, y: p.y, z: p.z, mode: 1, block: 1 })
  await b.waitFor(pk => pk.name === 'setBlock' && pk.x === p.x + 1 && pk.block === 1)
  assert.equal(server.levels.main.getBlock(p.x + 1, p.y, p.z), 1)

  // CPE block: classic client gets the fallback (sandstone 52 -> sand 12)
  a.send('setBlock', { x: p.x + 2, y: p.y, z: p.z, mode: 1, block: 52 })
  await b.waitFor(pk => pk.name === 'setBlock' && pk.x === p.x + 2)
  assert.equal(b.blockChanges.find(pk => pk.x === p.x + 2).block, 12)
  await a.waitFor(pk => pk.name === 'setBlock' && pk.x === p.x + 2 && pk.block === 52)

  // guests can't place bedrock: the server reverts it
  a.mark()
  a.send('setBlock', { x: p.x + 3, y: p.y, z: p.z, mode: 1, block: 7 })
  const revert = await a.waitFor(pk => pk.name === 'setBlock' && pk.x === p.x + 3)
  assert.equal(revert.block, 0)
  assert.equal(server.levels.main.getBlock(p.x + 3, p.y, p.z), 0)

  // far away blocks are rejected
  a.send('setBlock', { x: 60, y: 1, z: 60, mode: 0, block: 0 })
  await sleep(100)
  assert.notEqual(server.levels.main.getBlock(60, 1, 60), 0)

  // slabs stack into a double slab
  a.send('setBlock', { x: p.x, y: p.y, z: p.z + 1, mode: 1, block: 44 })
  a.send('setBlock', { x: p.x, y: p.y + 1, z: p.z + 1, mode: 1, block: 44 })
  await sleep(150)
  assert.equal(server.levels.main.getBlock(p.x, p.y, p.z + 1), 43)
  a.close(); b.close()
})

test('drawing with /cuboid uses BulkBlockUpdate and /undo reverts it', async (t) => {
  const { server } = await startServer({ owners: ['Builder1'] })
  t.after(() => server.stop())
  const a = await join(server, 'Builder1')
  const b = await join(server, 'Watcher', { cpe: false })
  const p = server.findPlayerExact('Builder1').blockPos

  a.chat('/cuboid glass')
  await a.waitForMessage(/mark the corners/)
  a.send('setBlock', { x: p.x, y: p.y, z: p.z, mode: 1, block: 1 })
  a.send('setBlock', { x: p.x + 3, y: p.y + 3, z: p.z + 3, mode: 1, block: 1 })
  await a.waitForMessage(/changed &f64/)
  await a.waitFor('bulkBlockUpdate')
  assert.equal(server.levels.main.getBlock(p.x + 2, p.y + 2, p.z + 2), 20)
  // the classic client has no BulkBlockUpdate and gets individual block changes
  await b.waitFor(pk => pk.name === 'setBlock' && pk.x === p.x + 2 && pk.y === p.y + 2 && pk.z === p.z + 2)
  assert.equal(b.level.blocks[server.levels.main.index(p.x + 2, p.y + 2, p.z + 2)], 20)
  assert.ok(!b.received.some(pk => pk.name === 'bulkBlockUpdate'))

  await command(a, '/undo')
  assert.equal(server.levels.main.getBlock(p.x + 2, p.y + 2, p.z + 2), 0)
  a.close(); b.close()
})

test('multiple levels, environment and custom blocks', async (t) => {
  const { server } = await startServer({ owners: ['Alice'] })
  t.after(() => server.stop())
  const a = await join(server, 'Alice')
  const b = await join(server, 'Bob', { cpe: false })

  assert.match(await command(a, '/newlvl second 32 32 48 island 7', 400), /Created level second/)
  a.mark()
  a.chat('/goto second')
  const fin = await a.waitFor('levelFinalize')
  assert.deepEqual([fin.x, fin.y, fin.z], [32, 32, 48])
  await b.waitFor(pk => pk.name === 'despawnPlayer')
  assert.equal(server.findPlayerExact('Alice').level.name, 'second')

  a.mark()
  a.chat('/env sky ff0000')
  const color = await a.waitFor(pk => pk.name === 'envSetColor' && pk.variable === 0)
  assert.deepEqual([color.r, color.g, color.b], [255, 0, 0])

  a.mark()
  a.chat('/texture https://example.com/pack.zip')
  const url = await a.waitFor('setMapEnvUrl')
  assert.equal(url.url, 'https://example.com/pack.zip')

  a.mark()
  a.chat('/lb preset 80 lamp')
  const def = await a.waitFor('defineBlockExt')
  assert.equal(def.block, 80)
  assert.equal(def.blockName, 'Lamp')
  assert.equal(def.fullBright, 1)
  assert.equal(server.levels.get('second').blockDefs[80].name, 'Lamp')

  // leaving the level removes its custom blocks from the client
  a.mark()
  a.chat('/main')
  await a.waitFor(pk => pk.name === 'removeBlockDefinition' && pk.block === 80)
  a.close(); b.close()
})

test('zones protect areas', async (t) => {
  const { server } = await startServer({ owners: ['Admin1'] })
  t.after(() => server.stop())
  const admin = await join(server, 'Admin1')
  const guest = await join(server, 'Guest1')
  const p = server.findPlayerExact('Guest1').blockPos

  admin.chat('/zone add safe Operator')
  await admin.waitForMessage(/mark the corners/)
  admin.send('setBlock', { x: p.x - 3, y: p.y - 3, z: p.z - 3, mode: 1, block: 1 })
  admin.send('setBlock', { x: p.x + 3, y: p.y + 3, z: p.z + 3, mode: 1, block: 1 })
  await admin.waitForMessage(/Zone &fsafe&a created/)

  guest.mark()
  guest.send('setBlock', { x: p.x + 1, y: p.y, z: p.z, mode: 1, block: 1 })
  await guest.waitForMessage(/protected by zone/)
  assert.equal(server.levels.main.getBlock(p.x + 1, p.y, p.z), 0)
  admin.close(); guest.close()
})

test('bans and ranks', async (t) => {
  const { server } = await startServer({ owners: ['Boss'] })
  t.after(() => server.stop())
  const boss = await join(server, 'Boss')
  const bob = await join(server, 'Bob')

  await command(boss, '/rank Bob Builder')
  assert.equal(server.playerDB.get('bob').rank, 'Builder')

  boss.chat('/ban Bob 1h griefing')
  await bob.waitFor('disconnect')
  assert.match(bob.kickReason, /Banned/)

  const again = new TestClient({ port: server.port, name: 'Bob' })
  await again.connect()
  await again.waitFor('disconnect')
  assert.match(again.kickReason, /Banned \(.*left\): griefing/)

  await command(boss, '/unban Bob')
  const ok = await join(server, 'Bob')
  ok.close(); boss.close()
})

test('web client over WebSocket on the same port', async (t) => {
  const { server } = await startServer()
  t.after(() => server.stop())
  const socket = net.connect(server.port, '127.0.0.1')
  await new Promise(resolve => socket.once('connect', resolve))
  const key = crypto.randomBytes(16).toString('base64')
  socket.write(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: ClassiCube\r\n\r\n`)

  let data = Buffer.alloc(0)
  socket.on('data', d => { data = Buffer.concat([data, d]) })
  await sleep(100)
  const head = data.toString('latin1')
  assert.match(head, /101 Switching Protocols/)
  assert.match(head, new RegExp('Sec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64').replace(/[+/]/g, '\\$&')))
  data = data.subarray(data.indexOf('\r\n\r\n') + 4)

  // masked binary frame with the identification packet (no CPE)
  const ident = Buffer.alloc(131)
  ident[0] = 0; ident[1] = 7
  packets.writeString(ident, 2, 'WebUser'); packets.writeString(ident, 66, '')
  const mask = crypto.randomBytes(4)
  const masked = Buffer.from(ident.map((b, i) => b ^ mask[i & 3]))
  socket.write(Buffer.concat([Buffer.from([0x82, 0x80 | 126, 0, 131]), mask, masked]))
  await sleep(300)

  // first frame from the server carries the server identification
  assert.equal(data[0], 0x82)
  const len = data[1] & 0x7f
  const payload = len === 126 ? data.subarray(4, 4 + data.readUInt16BE(2)) : data.subarray(2, 2 + len)
  assert.equal(payload[0], 0x00)
  assert.ok(server.findPlayerExact('WebUser'))
  assert.equal(server.findPlayerExact('WebUser').conn.isWebSocket, true)
  socket.destroy()
})

test('plugins can be unloaded and reloaded cleanly', async (t) => {
  const { server } = await startServer({ owners: ['Alice'] })
  t.after(() => server.stop())
  const a = await join(server, 'Alice')
  assert.ok(server.commands.find('warp'))
  assert.match(await command(a, '/punload warps'), /Unloaded/)
  assert.equal(server.commands.find('warp'), null)
  assert.match(await command(a, '/pload warps'), /Loaded plugin warps/)
  assert.ok(server.commands.find('warp'))
  assert.match(await command(a, '/pcreate myplugin'), /Created plugins\/myplugin/)
  assert.match(await command(a, '/pload myplugin'), /Loaded plugin myplugin/)
  assert.match(await command(a, '/myplugin'), /Hello from myplugin/)
  // unloading removes its event handlers too
  const before = [...server.events.handlers.values()].flat().length
  await command(a, '/punload myplugin')
  assert.ok([...server.events.handlers.values()].flat().length < before)
  a.close()
})

test('state survives a restart', async () => {
  const first = await startServer({ owners: ['Alice'] })
  const bob = await join(first.server, 'Bob')
  bob.close()
  const a = await join(first.server, 'Alice')
  const p = first.server.findPlayerExact('Alice').blockPos
  a.send('setBlock', { x: p.x + 1, y: p.y, z: p.z, mode: 1, block: 45 })
  await sleep(100)
  await command(a, '/rank Bob Builder')
  await command(a, '/warp create spot')
  a.close()
  await first.server.stop()

  const second = await startServer({ owners: ['Alice'] }, first.root)
  try {
    assert.equal(second.server.levels.main.getBlock(p.x + 1, p.y, p.z), 45)
    assert.equal(second.server.playerDB.get('bob').rank, 'Builder')
    const b = await join(second.server, 'Alice')
    assert.match(await command(b, '/warp list'), /spot/)
    b.close()
  } finally {
    await second.server.stop()
  }
})

test('ExtendedBlocks: ids above 255 reach capable clients, others get the fallback', async (t) => {
  const { server } = await startServer({ owners: ['Alice'] })
  t.after(() => server.stop())
  const level = server.levels.main
  server.setGlobalBlock({ id: 300, name: 'Big', fallback: 45 })
  level.setBlockRaw(5, 20, 5, 300)

  const ext = await join(server, 'Alice')
  const noExt = await join(server, 'Bob', {
    extensions: Object.entries(packets.EXTENSIONS).filter(([n]) => n !== 'ExtendedBlocks' && n !== 'ExtEntityPositions')
  })
  const i = level.index(5, 20, 5)
  assert.equal(ext.level.blocks[i] | (ext.level.upper[i] << 8), 300)
  assert.equal(noExt.level.blocks[i], 45)
  assert.ok(ext.received.some(p => p.name === 'defineBlockExt' && p.block === 300))
  assert.ok(!noExt.received.some(p => (p.name === 'defineBlockExt' || p.name === 'defineBlock') && p.block === 300))

  // placing block 300 from the capable client (2-byte block id in SetBlock)
  const pos = server.findPlayerExact('Alice').blockPos
  ext.send('setBlock', { x: pos.x + 1, y: pos.y, z: pos.z, mode: 1, block: 300 })
  const seen = await noExt.waitFor(p => p.name === 'setBlock' && p.x === pos.x + 1)
  assert.equal(seen.block, 45)
  assert.equal(level.getBlock(pos.x + 1, pos.y, pos.z), 300)

  // bulk updates carry the high bits
  ext.mark()
  level.setBlocks([[1, 20, 1, 300], [2, 20, 1, 300]])
  const bulk = await ext.waitFor('bulkBlockUpdate')
  assert.equal(bulk.blocks[0] | (((bulk.high[0] >> 0) & 3) << 8), 300)

  // levels bigger than 1023 need ExtEntityPositions
  assert.match(await command(ext, '/newlvl huge 1100 16 16 flat', 600), /Created level huge/)
  assert.match(await command(noExt, '/goto huge', 400), /too big for your client/)
  ext.mark()
  ext.chat('/goto huge')
  const fin = await ext.waitFor('levelFinalize', 5000)
  assert.equal(fin.x, 1100)
  ext.close(); noExt.close()
})

test('SQLite storage keeps players across restarts', { skip: (() => { try { require('node:sqlite'); return false } catch (e) { return true } })() }, async () => {
  const first = await startServer({ owners: ['Alice'], database: 'sqlite' })
  const bob = await join(first.server, 'Bob')
  bob.close()
  const a = await join(first.server, 'Alice')
  await command(a, '/rank Bob AdvBuilder')
  a.close()
  await first.server.stop()
  const second = await startServer({ database: 'sqlite' }, first.root)
  try {
    assert.equal(second.server.playerDB.constructor.name, 'SqlitePlayerDB')
    assert.equal(second.server.playerDB.get('bob').rank, 'AdvBuilder')
    assert.equal(second.server.playerDB.get('alice').logins, 1)
  } finally {
    await second.server.stop()
  }
})

test('plugins can be installed from a URL and from an npm package', async (t) => {
  const http = require('http')
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const code = "module.exports = { name: 'fromweb', version: '0.1.0', load (ctx) { ctx.command({ name: 'webhello', run (p) { p.message('hello from the web') } }) } }"
  const web = http.createServer((req, res) => { res.end(code) })
  await new Promise(resolve => web.listen(0, '127.0.0.1', resolve))
  const { server, root } = await startServer({ owners: ['Alice'] })
  t.after(() => { web.close(); return server.stop() })
  const a = await join(server, 'Alice')

  assert.match(await command(a, `/pinstall http://127.0.0.1:${web.address().port}/whatever.js`, 400), /Installed and loaded fromweb/)
  assert.match(await command(a, '/webhello'), /hello from the web/)
  assert.ok(fs.existsSync(path.join(root, 'plugins', 'fromweb.js')))
  assert.match(await command(a, '/puninstall fromweb'), /Removed fromweb/)
  assert.equal(server.commands.find('webhello'), null)
  assert.ok(!fs.existsSync(path.join(root, 'plugins', 'fromweb.js')))

  // a local npm package (file: spec works offline)
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'mcscript-pkg-'))
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'mcscript-plugin-demo', version: '1.2.3', main: 'main.js' }))
  fs.writeFileSync(path.join(pkg, 'main.js'), "module.exports = { name: 'demo', version: '1.2.3', load (ctx) { ctx.command({ name: 'demohi', run (p) { p.message('npm plugin works') } }) } }")
  a.mark()
  a.chat(`/pinstall npm:file:${pkg}`)
  await a.waitForMessage(/Installed and loaded demo v1.2.3/, 60000)
  assert.match(await command(a, '/demohi'), /npm plugin works/)
  assert.ok(fs.existsSync(path.join(root, 'plugins', 'demo', 'node_modules', 'mcscript-plugin-demo')))
  a.close()
})

test('physics: sand falls, water flows, sponges and water + lava', async (t) => {
  const { server } = await startServer({ owners: ['Alice'] })
  t.after(() => server.stop())
  const level = server.levels.main // flat: ground at y 0..15, air above
  const set = (x, y, z, b) => { level.setBlock(x, y, z, b); server.plugins.get('physics').module.api.schedule(level, x, y, z) }

  set(10, 25, 10, 12) // sand in the air
  await sleep(400)
  assert.equal(level.getBlock(10, 25, 10), 0)
  assert.equal(level.getBlock(10, 16, 10), 12)

  set(20, 16, 20, 8) // active water on the ground
  await sleep(700)
  assert.equal(level.getBlock(21, 16, 20), 8)
  assert.equal(level.getBlock(19, 16, 20), 8)

  set(40, 16, 40, 19) // a sponge stops water nearby
  set(43, 16, 40, 8)
  await sleep(900)
  assert.notEqual(level.getBlock(42, 16, 40), 8)

  set(30, 16, 30, 10) // lava next to flowing water turns into stone
  set(32, 16, 30, 8)
  await sleep(1500)
  assert.ok(level.getBlock(30, 16, 30) === 1 || level.getBlock(31, 16, 30) === 1)

  // /physics 0 stops everything
  const a = await join(server, 'Alice')
  assert.match(await command(a, '/physics 0'), /Physics in main set to &f0/)
  set(50, 25, 50, 12)
  await sleep(300)
  assert.equal(level.getBlock(50, 25, 50), 12)
  a.close()
})

test('block history is kept on disk: /about and /undoplayer work after a restart', async () => {
  const first = await startServer({ owners: ['Admin'] })
  let p, before
  try {
    const g = await join(first.server, 'Griefer')
    p = first.server.findPlayerExact('Griefer').blockPos
    const level = first.server.levels.main
    before = level.getBlock(p.x + 1, p.y - 1, p.z)
    g.send('setBlock', { x: p.x + 1, y: p.y - 1, z: p.z, mode: 0, block: 0 })
    g.send('setBlock', { x: p.x + 1, y: p.y, z: p.z, mode: 1, block: 45 })
    await sleep(200)
    assert.equal(level.getBlock(p.x + 1, p.y, p.z), 45)
    g.close()
  } finally {
    await first.server.stop()
  }

  const second = await startServer({ owners: ['Admin'] }, first.root)
  try {
    const lvl = second.server.levels.main
    const admin = await join(second.server, 'Admin')
    admin.chat('/about')
    await admin.waitForMessage(/mark the position/)
    admin.send('setBlock', { x: p.x + 1, y: p.y, z: p.z, mode: 0, block: 0 })
    await admin.waitForMessage(/Last changed by &fGriefer/)
    assert.match(await command(admin, '/undoplayer Griefer 1h', 300), /Undid &f2&e block changes by Griefer/)
    assert.equal(lvl.getBlock(p.x + 1, p.y, p.z), 0)
    assert.equal(lvl.getBlock(p.x + 1, p.y - 1, p.z), before)
    admin.close()
  } finally {
    await second.server.stop()
  }
})

test('economy: pay, shop ranks and personal levels', async (t) => {
  const { server } = await startServer({ owners: ['Boss'] })
  t.after(() => server.stop())
  const boss = await join(server, 'Boss')
  const ann = await join(server, 'Ann')
  const eco = server.plugins.get('economy').module.api

  assert.match(await command(ann, '/money'), /Ann has &a50 coins/)
  assert.match(await command(ann, '/pay Boss 20'), /You paid &a20 coins/)
  assert.equal(eco.balance('boss'), 70)
  assert.match(await command(ann, '/pay Boss 1000'), /You only have/)
  assert.match(await command(ann, '/buy rank Builder'), /That costs 200 coins/)

  await command(boss, '/eco give Ann 2000')
  assert.match(await command(ann, '/buy rank Builder', 300), /bought the .*Builder/)
  assert.equal(server.playerDB.get('ann').rank, 'Builder')

  ann.mark()
  ann.chat('/buy level')
  await ann.waitForMessage(/You bought the level/, 5000)
  const level = server.levels.get('Ann')
  assert.deepEqual(level.owners, ['ann'])
  // only the owner builds there
  assert.equal(level.canBuild(server.findPlayerExact('Ann')), true)
  const other = await join(server, 'Visitor')
  assert.equal(level.canBuild(server.findPlayerExact('Visitor')), false)
  other.close(); ann.close(); boss.close()
})

test('web panel: token auth, status, players and commands', async (t) => {
  const { server } = await startServer({ owners: ['Alice'] }, null, { 'web-panel': { enabled: true, host: '127.0.0.1', port: 0, token: 'secret-token' } })
  t.after(() => server.stop())
  const api = server.plugins.get('web-panel').module.api
  for (let i = 0; i < 20 && !api.port; i++) await sleep(50)
  const base = `http://127.0.0.1:${api.port}`
  const a = await join(server, 'Alice')

  const page = await fetch(base + '/')
  assert.equal(page.status, 200)
  assert.match(await page.text(), /MCScript · Panel/)
  assert.equal((await fetch(base + '/api/status')).status, 401)
  assert.equal((await fetch(base + '/api/status', { headers: { Authorization: 'Bearer wrong-token!' } })).status, 401)

  const auth = { Authorization: 'Bearer secret-token', 'Content-Type': 'application/json' }
  const status = await (await fetch(base + '/api/status', { headers: auth })).json()
  assert.equal(status.players, 1)
  const players = await (await fetch(base + '/api/players', { headers: auth })).json()
  assert.equal(players[0].name, 'Alice')
  const out = await (await fetch(base + '/api/command', { method: 'POST', headers: auth, body: JSON.stringify({ command: '/levels' }) })).json()
  assert.match(out.output.join('\n'), /main/)
  await fetch(base + '/api/command', { method: 'POST', headers: auth, body: JSON.stringify({ command: 'hello from the panel' }) })
  await a.waitForMessage(/hello from the panel/)
  const logs = await (await fetch(base + '/api/logs', { headers: auth })).json()
  assert.ok(logs.some(l => /Alice/.test(l.message)))
  a.close()
})

const moveTo = (client, x, y, z) => client.send('position', { heldBlock: 1, x: Math.round(x * 32), y: Math.round(y * 32) + 51, z: Math.round(z * 32), yaw: 0, pitch: 0 })

test('minigames: zombie survival infection and parkour timing', async (t) => {
  const { server } = await startServer({ owners: ['Op'] })
  t.after(() => server.stop())
  const op = await join(server, 'Op')
  const guest = await join(server, 'Guest')

  // Zombie Survival
  assert.match(await command(op, '/zombie enable'), /is now a Zombie Survival arena/)
  await command(op, '/zombie join')
  await command(guest, '/zombie join')
  op.mark(); guest.mark()
  op.chat('/zombie start')
  await op.waitForMessage(/has started/)
  const round = server.plugins.get('minigames').module.api.games.zombie.rounds.get('main')
  const [zombie] = round.firstZombies()
  const human = zombie.name === 'Op' ? server.findPlayerExact('Guest') : server.findPlayerExact('Op')
  const zClient = zombie.name === 'Op' ? op : guest
  const hClient = zombie.name === 'Op' ? guest : op
  assert.equal(human.data.team, 'human')
  moveTo(zClient, 10, 17, 10)
  moveTo(hClient, 10.5, 17, 10.3)
  await hClient.waitForMessage(/infected everyone/, 3000)
  assert.equal(round.state, 'waiting')
  assert.equal(human.currentModel, 'humanoid')
  assert.equal(human.record.model, null)

  // Parkour: start at (20,15,20), finish at (30,15,20): the blocks you stand on
  const setBlockMark = async (client, cmd, x, y, z) => {
    client.mark(); client.chat(cmd)
    await client.waitForMessage(/Place or break/)
    client.send('setBlock', { x, y, z, mode: 1, block: 1 })
    await client.waitForMessage(/set at|added/)
  }
  moveTo(op, 22, 17, 20)
  await sleep(100)
  await setBlockMark(op, '/parkour setstart', 20, 15, 20)
  moveTo(op, 28, 17, 20)
  await sleep(100)
  await setBlockMark(op, '/parkour setfinish', 30, 15, 20)
  moveTo(guest, 20.5, 16, 20.5)
  await guest.waitForMessage(/Parkour started/)
  await sleep(300)
  moveTo(guest, 30.5, 16, 20.5)
  await guest.waitForMessage(/new parkour record|Finished in/)
  assert.match(await command(guest, '/parkour top'), /1\. Guest/)
  op.close(); guest.close()
})

test('minigames: TNT Wars explosions score points', async (t) => {
  const { server } = await startServer({ owners: ['Op'] })
  t.after(() => server.stop())
  const op = await join(server, 'Op')
  const guest = await join(server, 'Guest')
  await command(op, '/tntwars enable')
  moveTo(op, 10.5, 16, 10.5); await sleep(100)
  await command(op, '/tntwars setspawn red')
  moveTo(op, 12.5, 16, 10.5); await sleep(100)
  await command(op, '/tntwars setspawn blue')
  await command(op, '/tntwars join')
  await command(guest, '/tntwars join')
  op.mark()
  op.chat('/tntwars start')
  await op.waitForMessage(/has started/)
  const p1 = server.findPlayerExact('Op'); const p2 = server.findPlayerExact('Guest')
  assert.notEqual(p1.data.team, p2.data.team)
  // stand next to each other and Op drops TNT between them (right click on the ground)
  moveTo(op, 20.5, 16, 20.5)
  moveTo(guest, 22.5, 16, 20.5)
  await sleep(150)
  op.send('playerClicked', { button: 1, action: 0, yaw: 0, pitch: 0, targetEntity: -1, x: 21, y: 15, z: 20, face: 3 })
  await op.waitFor(p => p.name === 'setBlock' && p.x === 21 && p.y === 16 && p.block === 46)
  await guest.waitForMessage(/Op&e blew up/, 4000)
  assert.equal(server.levels.main.getBlock(21, 16, 20), 0)
  // the arena is restored when the round ends
  await command(op, '/tntwars stop', 400)
  assert.equal(server.levels.main.getBlock(21, 15, 20), 2)
  op.close(); guest.close()
})

test('minigames: capture the flag', async (t) => {
  const { server } = await startServer({ owners: ['Op'] }, null, { minigames: { ctf: { captures: 1, timeLimitMinutes: 5, tagDistance: 4 } } })
  t.after(() => server.stop())
  const op = await join(server, 'Op')
  const guest = await join(server, 'Guest')
  await command(op, '/ctf enable')
  const flag = async (team, x, z) => {
    moveTo(op, x + 2.5, 16, z + 0.5); await sleep(100)
    op.mark(); op.chat(`/ctf setflag ${team}`)
    await op.waitForMessage(/Place or break/)
    op.send('setBlock', { x, y: 16, z, mode: 1, block: 1 })
    await op.waitForMessage(/flag set/)
  }
  await flag('red', 10, 10)
  await flag('blue', 40, 40)
  moveTo(op, 12.5, 16, 12.5); await sleep(100); await command(op, '/ctf setspawn red')
  moveTo(op, 38.5, 16, 38.5); await sleep(100); await command(op, '/ctf setspawn blue')
  await command(op, '/ctf join')
  await command(guest, '/ctf join')
  op.mark(); op.chat('/ctf start')
  await op.waitForMessage(/has started/)
  const me = server.findPlayerExact('Op')
  const [enemyFlag, ownFlag] = me.data.team === 'red' ? [[40, 40], [10, 10]] : [[10, 10], [40, 40]]
  moveTo(op, enemyFlag[0] + 0.5, 16, enemyFlag[1] + 0.5)
  await op.waitForMessage(/took the/)
  assert.equal(server.levels.main.getBlock(enemyFlag[0], 16, enemyFlag[1]), 0)
  moveTo(op, ownFlag[0] + 0.5, 16, ownFlag[1] + 0.5)
  await op.waitForMessage(/team wins 1-0|team wins 0-1/, 3000)
  op.close(); guest.close()
})
