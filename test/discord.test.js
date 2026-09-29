'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { startServer, sleep } = require('./helpers/server')
const { TestClient } = require('./helpers/client')
const { chunks } = require('../plugins/relay-discord')

const CHAT = '100'
const STAFF = '200'
const MOD_ROLE = '300'

// Plays the Discord gateway: says hello, answers identify with READY and lets the test push messages
class FakeGateway {
  constructor (url) {
    FakeGateway.last = this
    this.url = url
    this.readyState = 1
    this.sent = []
    this.seq = 0
    setImmediate(() => this.onmessage({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }) }))
  }

  send (raw) {
    const msg = JSON.parse(raw)
    this.sent.push(msg)
    if (msg.op === 2) setImmediate(() => this.dispatch('READY', { session_id: 'abc', resume_gateway_url: 'wss://resume.example', user: { id: '1', username: 'MCBot' } }))
  }

  dispatch (t, d) { this.onmessage({ data: JSON.stringify({ op: 0, t, s: ++this.seq, d }) }) }
  close () { this.readyState = 3 }
}

let nextId = 1000
function discordMessage (channel, user, content, { roles = [], mentions = [] } = {}) {
  FakeGateway.last.dispatch('MESSAGE_CREATE', {
    id: String(nextId++),
    channel_id: channel,
    content,
    author: { id: user.id, username: user.name, bot: !!user.bot },
    member: { nick: null, roles },
    mentions
  })
}

async function join (server, name) {
  const c = new TestClient({ port: server.port, name })
  await c.connect()
  await c.waitFor('levelFinalize')
  await c.waitFor(p => p.name === 'extAddEntity2' && p.id === -1)
  return c
}

const chatLines = c => c.received.filter(p => p.name === 'message').map(p => p.message).join('\n')

test('Discord bot: chat bridge, staff channel and commands', async (t) => {
  const posted = []
  const realFetch = globalThis.fetch
  const realWebSocket = globalThis.WebSocket
  globalThis.fetch = async (url, opts) => {
    const m = String(url).match(/^https:\/\/discord\.com\/api\/v10\/channels\/(\d+)\/messages$/)
    if (!m) return realFetch(url, opts)
    assert.equal(opts.headers.Authorization, 'Bot secret-token')
    const body = JSON.parse(opts.body)
    assert.deepEqual(body.allowed_mentions, { parse: [] })
    posted.push({ channel: m[1], content: body.content })
    return new Response('{}', { status: 200 })
  }
  globalThis.WebSocket = FakeGateway
  t.after(() => { globalThis.fetch = realFetch; globalThis.WebSocket = realWebSocket })

  const { server } = await startServer({ owners: ['Boss'] }, null, {
    'relay-discord': {
      enabled: true,
      botToken: 'secret-token',
      chatChannelIds: [CHAT],
      staffChannelIds: [STAFF],
      roleRanks: { [MOD_ROLE]: 'Operator' },
      inviteUrl: 'https://discord.gg/example'
    }
  })
  t.after(() => server.stop())
  await sleep(100)

  const identify = FakeGateway.last.sent.find(m => m.op === 2)
  assert.equal(identify.d.token, 'secret-token')
  assert.equal(identify.d.intents, (1 << 0) | (1 << 9) | (1 << 15))
  assert.equal(identify.d.presence.activities[0].name, 'with 0/20 players')

  const boss = await join(server, 'Boss')
  const alice = await join(server, 'Alice')
  const said = async (ms = 500) => { await sleep(ms); const out = posted.splice(0); return out }
  await said()

  // game -> Discord
  alice.chat('hello *everyone*')
  const out1 = await said()
  assert.deepEqual(out1, [{ channel: CHAT, content: '**Alice**: hello \\*everyone\\*' }])

  // Discord -> game, with a mention turned into a name
  alice.mark()
  discordMessage(CHAT, { id: '42', name: 'dana' }, 'hi <@43>!', { mentions: [{ id: '43', username: 'eve' }] })
  await sleep(200)
  assert.match(chatLines({ received: alice.received.slice(alice.cursor) }), /\[Discord\] &fdana: hi @eve!/)

  // the bot ignores itself and other bots
  discordMessage(CHAT, { id: '1', name: 'MCBot' }, 'echo')
  discordMessage(CHAT, { id: '7', name: 'otherbot', bot: true }, 'beep')
  await sleep(200)
  assert.doesNotMatch(chatLines(alice), /echo|beep/)

  // !players and MCGalaxy's .who
  discordMessage(CHAT, { id: '42', name: 'dana' }, '!players')
  let out = await said()
  assert.match(out[0].content, /\*\*Online \(2\/20\):\*\* Boss, Alice/)

  // public commands work for anyone, and the output comes back as a code block
  discordMessage(CHAT, { id: '42', name: 'dana' }, '!rules')
  out = await said()
  assert.match(out[0].content, /^```\n[\s\S]*Be respectful/)

  // other commands need a mapped role
  discordMessage(CHAT, { id: '42', name: 'dana' }, '!kick Alice spam')
  out = await said()
  assert.match(out[0].content, /don't have permission to use `kick`/)
  assert.ok(server.findPlayerExact('Alice'))

  // banned commands are refused even for staff
  discordMessage(STAFF, { id: '50', name: 'mod' }, '!pinstall https://example.com/x.js')
  out = await said()
  assert.match(out[0].content, /can't be used from Discord/)

  // staff channel <-> in-game staff chat
  boss.mark(); alice.mark()
  discordMessage(STAFF, { id: '50', name: 'mod' }, 'watch Alice')
  await sleep(200)
  assert.match(chatLines({ received: boss.received.slice(boss.cursor) }), /\[Op\] &9\(Discord\) mod&c: &fwatch Alice/)
  assert.doesNotMatch(chatLines({ received: alice.received.slice(alice.cursor) }), /watch Alice/)
  boss.chat('#on it')
  out = await said()
  assert.deepEqual(out, [{ channel: STAFF, content: '[Op] **Boss**: on it' }])
  assert.ok(!out.some(o => o.channel === CHAT))

  // staff commands run with the staff rank, never with console powers
  discordMessage(STAFF, { id: '50', name: 'mod' }, '!rank Alice Owner')
  out = await said()
  assert.match(out[0].content, /only give ranks lower than your own/)
  assert.notEqual(server.playerDB.get('Alice').rank, 'Owner')

  // a user with a mapped role can moderate from the public channel
  discordMessage(CHAT, { id: '60', name: 'helper' }, '!kick Alice spam', { roles: [MOD_ROLE] })
  await sleep(500)
  assert.equal(server.findPlayerExact('Alice'), null)

  // /discord shows the invite link
  boss.mark()
  boss.chat('/discord')
  await sleep(150)
  assert.match(chatLines({ received: boss.received.slice(boss.cursor) }), /discord\.gg\/example/)
})

test('Discord messages are split under the 2000 character limit', () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i} `.padEnd(60, 'x'))
  const parts = chunks(lines, true)
  assert.ok(parts.length > 1)
  for (const p of parts) {
    assert.ok(p.length <= 2000)
    assert.ok(p.startsWith('```\n') && p.endsWith('\n```'))
  }
  assert.equal(parts.join('').split('line ').length - 1, 100)
})
