'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const crypto = require('crypto')

const { startServer, sleep } = require('./helpers/server')
const { TestClient } = require('./helpers/client')
const { Player } = require('../lib/player')

const md5 = s => crypto.createHash('md5').update(s).digest('hex')

// Stand-in for classicube.net and betacraft.uk: remembers the salt each heartbeat sends
function fakeList () {
  const salts = {}
  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      salts[req.url] = new URLSearchParams(body).get('salt')
      res.end(`http://list.example${req.url}/play`)
    })
  })
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve({ srv, salts, base: `http://127.0.0.1:${srv.address().port}` })))
}

async function login (server, name, key) {
  const c = new TestClient({ port: server.port, name, key, cpe: false })
  await c.connect()
  const p = await c.waitFor(p => p.name === 'levelFinalize' || p.name === 'disconnect', 8000)
  c.close()
  return p.name === 'disconnect' ? { kicked: p.reason } : { ok: true }
}

test('name verification against several server lists and Mojang sessions', async (t) => {
  const list = await fakeList()
  t.after(() => list.srv.close())

  // tests connect from 127.0.0.1, which normally skips verification
  const isLocal = Player.prototype._isLocalIp
  Player.prototype._isLocalIp = () => false
  t.after(() => { Player.prototype._isLocalIp = isLocal })

  // pretend to be sessionserver.mojang.com: only Carl joined, from 127.0.0.1
  const realFetch = globalThis.fetch
  const mojangCalls = []
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://sessionserver.mojang.com/')) {
      const u = new URL(url)
      mojangCalls.push(u.searchParams.get('username'))
      const ok = u.searchParams.get('username') === 'Carl' && u.searchParams.get('serverId') === crypto.createHash('sha1').update('127.0.0.1').digest('hex')
      return new Response(ok ? '{"id":"x","name":"Carl"}' : '', { status: ok ? 200 : 204 })
    }
    return realFetch(url, opts)
  }
  t.after(() => { globalThis.fetch = realFetch })

  const { server } = await startServer({
    verifyNames: true,
    heartbeatUrl: `${list.base}/classicube`,
    extraHeartbeats: [{ url: `${list.base}/betacraft`, nameSuffix: '+', mojangAuth: true }]
  })
  t.after(() => server.stop())
  for (let i = 0; i < 50 && Object.keys(list.salts).length < 2; i++) await sleep(50)

  const cc = list.salts['/classicube']
  const bc = list.salts['/betacraft']
  assert.ok(cc && bc && cc !== bc, 'each list gets its own salt')
  assert.equal(server.heartbeats[1].url, 'http://list.example/betacraft/play')

  assert.deepEqual(await login(server, 'Alice', md5(cc + 'Alice')), { ok: true })
  assert.ok(server.playerDB.get('Alice'))

  assert.deepEqual(await login(server, 'Bob', md5(bc + 'Bob')), { ok: true })
  assert.ok(server.playerDB.get('Bob+'), 'BetaCraft accounts get the suffix')
  assert.equal(server.playerDB.get('Bob'), null)

  assert.deepEqual(await login(server, 'Carl', ''), { ok: true })
  assert.ok(server.playerDB.get('Carl+'))

  assert.match((await login(server, 'Dave', 'wrong')).kicked, /Login failed/)
  assert.deepEqual(mojangCalls, ['Carl', 'Dave'])
})
