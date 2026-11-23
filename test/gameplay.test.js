'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { startServer, sleep } = require('./helpers/server')
const { TestClient } = require('./helpers/client')

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

const since = c => c.received.slice(c.cursor)
const click = (c, button, x, y, z, face = 3) => c.send('playerClicked', { button, action: 0, yaw: 0, pitch: 0, targetEntity: -1, x, y, z, face })

test('a big draw re-sends the level instead of thousands of block updates', async (t) => {
  const { server } = await startServer({ owners: ['Boss'] })
  t.after(() => server.stop())
  const boss = await join(server, 'Boss')
  const other = await join(server, 'Other')
  const level = server.levels.main

  // small change: block updates
  other.mark()
  level.setBlocks([[1, 20, 1, 1], [2, 20, 2, 1]])
  await sleep(150)
  assert.ok(since(other).some(p => p.name === 'bulkBlockUpdate'))
  assert.ok(!since(other).some(p => p.name === 'levelInitializeFast'))

  // 64x16x64 = 65536 blocks, far over 0.1% of the level: the level is sent again, positions kept
  other.mark()
  await command(boss, '/cuboid 1')
  boss.send('setBlock', { x: 0, y: 17, z: 0, mode: 1, block: 1 })
  boss.send('setBlock', { x: 63, y: 30, z: 63, mode: 1, block: 1 })
  await other.waitFor(p => p.name === 'levelFinalize')
  await sleep(200)
  assert.ok(!since(other).some(p => p.name === 'bulkBlockUpdate'), 'no bulk updates for a huge change')
  assert.equal(other.level.blocks[(20 * 64 + 10) * 64 + 10], 1, 'the re-sent level has the new blocks')
  assert.equal(server.findPlayerExact('Other').level, level)
})

test('selections are marked by right clicks too, even with a block that can\'t be placed', async (t) => {
  const { server } = await startServer({ owners: ['Boss'] })
  t.after(() => server.stop())
  const boss = await join(server, 'Boss')
  const level = server.levels.main

  await command(boss, '/cuboid 1')
  // right click the top of (5, 15, 5): the mark is the spot a block would go, (5, 16, 5)
  click(boss, 1, 5, 15, 5, 3)
  await sleep(50)
  // the client also sends the block it placed there: it must be reverted, not counted twice or placed
  boss.send('setBlock', { x: 5, y: 16, z: 5, mode: 1, block: 20 })
  await sleep(50)
  assert.equal(level.getBlock(5, 16, 5), 0)
  // left click marks the clicked block itself
  click(boss, 0, 7, 17, 7)
  await sleep(200)
  assert.equal(level.getBlock(5, 16, 5), 1)
  assert.equal(level.getBlock(7, 17, 7), 1)
  assert.equal(level.getBlock(6, 16, 6), 1)
  // the block change sent with the last click didn't break anything after the selection ended
  boss.send('setBlock', { x: 7, y: 17, z: 7, mode: 0, block: 0 })
  await sleep(100)
  assert.equal(level.getBlock(7, 17, 7), 1)
})

test('idle players go AFK and are kicked; dead connections time out', async (t) => {
  const { server } = await startServer({ owners: ['Boss'], timeoutSeconds: 0 }, null, {
    'core-essentials': { autoAfkMinutes: 5, afkKickMinutes: 45 }
  })
  t.after(() => server.stop())
  await join(server, 'Boss')
  const idle = await join(server, 'Idle')
  const p = server.findPlayerExact('Idle')

  // the same position again and again is not activity
  p.lastActivity = Date.now() - 60000
  const pos = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch, heldBlock: 1 }
  for (let i = 0; i < 3; i++) idle.send('position', pos)
  await sleep(100)
  assert.ok(Date.now() - p.lastActivity >= 59000)
  idle.send('position', { ...pos, x: pos.x + 64 })
  await sleep(100)
  assert.ok(Date.now() - p.lastActivity < 5000)

  // kick after afkKickMinutes, but not operators and up
  const essentials = server.plugins.get('core-essentials')
  assert.ok(essentials)
  p.lastActivity = Date.now() - 46 * 60000
  server.findPlayerExact('Boss').lastActivity = Date.now() - 46 * 60000
  await sleep(15500)
  assert.match(idle.kickReason || '', /AFK/)
  assert.ok(!server.findPlayerExact('Idle'))
  assert.ok(server.findPlayerExact('Boss'), 'the owner is not kicked for being AFK')

  // a client that stops sending anything is dropped after timeoutSeconds
  server.config.timeoutSeconds = 1
  const frozen = await join(server, 'Frozen')
  frozen.socket.pause()
  const fp = server.findPlayerExact('Frozen')
  fp.conn.lastReceived = Date.now() - 5000
  await sleep(5500)
  assert.ok(!server.findPlayerExact('Frozen'))
})

test('/about reads the history on disk: draws, restarts and flowing lava', async (t) => {
  const first = await startServer({ owners: ['Boss'] })
  let server = first.server
  const root = first.root
  let boss = await join(server, 'Boss')
  const griefer = await join(server, 'Griefer')
  await command(boss, '/rank Griefer Operator')
  await command(boss, '/cuboid 45')
  boss.send('setBlock', { x: 1, y: 16, z: 1, mode: 1, block: 1 })
  boss.send('setBlock', { x: 3, y: 16, z: 3, mode: 1, block: 1 })
  await sleep(200)
  griefer.send('setBlock', { x: 30, y: 16, z: 30, mode: 1, block: 10 })
  await sleep(200)
  await server.stop()

  server = (await startServer({ owners: ['Boss'] }, root)).server
  t.after(() => server.stop())
  boss = await join(server, 'Boss')
  const ask = async (x, y, z) => {
    const out = command(boss, '/about', 100)
    await out
    boss.mark()
    boss.send('setBlock', { x, y, z, mode: 0, block: 0 })
    await sleep(200)
    return since(boss).filter(p => p.name === 'message').map(p => p.message).join('\n')
  }
  assert.match(await ask(2, 16, 2), /Boss.*Brick/)
  // lava that flowed somewhere nobody placed it: who placed lava nearby
  server.levels.main.setBlock(33, 16, 30, 10)
  const out = await ask(33, 16, 30)
  assert.match(out, /flowed here/)
  assert.match(out, /Griefer.*\(30, 16, 30\)/)
})

test('zombie survival gives the humans a head start; rounds start again by themselves', async (t) => {
  const { server } = await startServer({ owners: ['Boss'] }, null, {
    minigames: { zombie: { minutes: 5, touchDistance: 50, graceSeconds: 1 }, intermissionSeconds: 1 }
  })
  t.after(() => server.stop())
  const boss = await join(server, 'Boss')
  const other = await join(server, 'Other')
  await command(boss, '/zombie enable')
  await command(boss, '/zombie join')
  await command(other, '/zombie join')
  await command(boss, '/zombie start', 300)
  const game = server.plugins.get('minigames').module.api.games.zombie
  const round = game.rounds.get('main')
  assert.ok(round.running)
  const teams = [...round.players].map(p => p.data.team).sort()
  assert.deepEqual(teams, ['human', 'zombie'], 'nobody is infected at the start, even standing together')
  await sleep(1300)
  // after the head start, touching infects (touchDistance is huge here): the zombies win
  assert.equal(round.running, false)
  assert.equal(round.queued.size, 2, 'both go into the next round')
  await sleep(1200)
  assert.equal(round.state, 'countdown', 'the next round is counting down on its own')
  await command(other, '/zombie leave')
  assert.ok(!round.has(server.findPlayerExact('Other')))
})

test('TNT Wars gives a TNT-only inventory and takes it back', async (t) => {
  const { server } = await startServer({ owners: ['Boss'] })
  t.after(() => server.stop())
  const boss = await join(server, 'Boss')
  const other = await join(server, 'Other')
  await command(boss, '/tntwars enable')
  await command(boss, '/tntwars join')
  await command(other, '/tntwars join')
  other.mark()
  await command(boss, '/tntwars start', 300)
  const got = since(other)
  const held = got.filter(p => p.name === 'holdThis').pop()
  assert.deepEqual([held.block, held.preventChange], [46, 1])
  const perms = got.filter(p => p.name === 'setBlockPermission')
  assert.equal(perms.find(p => p.block === 46).allowPlace, 1)
  assert.equal(perms.find(p => p.block === 1).allowPlace, 0)
  assert.ok(perms.every(p => p.allowDelete === 0))
  const order = got.filter(p => p.name === 'setInventoryOrder')
  assert.equal(order.find(p => p.block === 46).order, 1)
  assert.equal(order.find(p => p.block === 1).order, 0)
  assert.equal(got.filter(p => p.name === 'setHotbar').filter(p => p.block === 46).length, 9)

  other.mark()
  await command(boss, '/tntwars stop', 300)
  const back = since(other)
  assert.equal(back.filter(p => p.name === 'setInventoryOrder').find(p => p.block === 1).order, 1)
  assert.equal(back.filter(p => p.name === 'holdThis').pop().preventChange, 0)
  assert.equal(back.filter(p => p.name === 'setBlockPermission').find(p => p.block === 1).allowPlace, 1)
})

test('/tour flies with hacks on and puts the level\'s hacks back', async (t) => {
  const { server } = await startServer({ owners: ['Boss'] }, null, { extras: { tourSeconds: 0.2, hud: false } })
  t.after(() => server.stop())
  const boss = await join(server, 'Boss')
  server.levels.main.motd = '-hax'
  await command(boss, '/tour add First')
  await command(boss, '/tour add Second')
  assert.match(await command(boss, '/tour list'), /1\..*First[\s\S]*2\..*Second/)
  boss.mark()
  boss.chat('/tour')
  await sleep(700)
  const got = since(boss)
  const hacks = got.filter(p => p.name === 'hackControl')
  assert.equal(hacks[0].flying, 1)
  assert.equal(hacks[0].noClip, 1)
  assert.ok(got.some(p => p.name === 'velocityControl' && p.y === 0 && p.modeY === 1), 'the fall speed is reset while flying')
  assert.ok(got.filter(p => p.name === 'teleport').length >= 3)
  // over: -hax from the MOTD again
  const last = hacks[hacks.length - 1]
  assert.deepEqual([last.flying, last.noClip, last.speeding], [0, 0, 0])
})

test('CTF puts the arena back and sends everyone to the spawn when a round ends', async (t) => {
  const { server } = await startServer({ owners: ['Boss'] }, null, { minigames: { intermissionSeconds: 1 } })
  t.after(() => server.stop())
  const boss = await join(server, 'Boss')
  const other = await join(server, 'Other')
  const level = server.levels.main
  await command(boss, '/ctf enable')
  level.meta.ctf.flags = { red: { x: 5, y: 16, z: 5 }, blue: { x: 50, y: 16, z: 50 } }
  level.meta.ctf.spawns = { red: { x: 8.5, y: 16, z: 8.5 }, blue: { x: 48.5, y: 16, z: 48.5 } }
  await command(boss, '/ctf join')
  await command(other, '/ctf join')
  await command(boss, '/ctf start', 300)
  const round = server.plugins.get('minigames').module.api.games.ctf.rounds.get('main')
  assert.ok(round.running)
  // the game changes the map: a hole, a block, a taken flag
  level.setBlocks([[20, 15, 20, 0], [21, 16, 21, 1], [50, 16, 50, 0]])
  const p = server.findPlayerExact('Other')
  p.teleport(30, 25, 30)
  round.end([], 'test')
  await sleep(200)
  assert.equal(level.getBlock(20, 15, 20), 2)
  assert.equal(level.getBlock(21, 16, 21), 0)
  assert.equal(level.getBlock(50, 16, 50), 29, 'the flag is back')
  assert.equal(Math.floor(p.feetPos.x), Math.floor(level.spawn.x), 'back at the spawn')
  await sleep(1200)
  assert.equal(round.state, 'countdown')
})
