'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Announces the server on a server list (classicube.net, betacraft.uk...). Every list gets its own
// salt, which is what players' mppass is checked against when they log in through that list.
class Heartbeat {
  constructor (server, { url, nameSuffix = '', skinPrefix = '', mojangAuth = false, primary = false } = {}) {
    this.server = server
    this.listUrl = url
    this.nameSuffix = nameSuffix
    this.skinPrefix = skinPrefix
    this.mojangAuth = mojangAuth
    this.primary = primary
    this.salt = randomSalt(16)
    this.timer = null
    this.url = null // the server's page on that list, once it answered
    this.lastError = null
    let host = url
    try { host = new URL(url).hostname.replace(/^(www|api)\./, '') } catch (err) {}
    this.label = host
  }

  start () {
    this.stop()
    this.beat()
    this.timer = setInterval(() => this.beat(), (this.server.config.heartbeatInterval || 45) * 1000)
    this.timer.unref()
  }

  stop () {
    clearInterval(this.timer)
    this.timer = null
  }

  params () {
    const s = this.server
    const cfg = s.config
    return new URLSearchParams({
      name: s.text.stripColors(cfg.name),
      port: String(s.port),
      users: String(s.online.filter(p => !p.hidden).length),
      max: String(cfg.maxPlayers),
      public: cfg.public ? 'True' : 'False',
      salt: this.salt,
      software: `&bMCScript &f${s.version}`,
      web: cfg.allowWebClient ? 'True' : 'False',
      version: '7'
    })
  }

  // mppass the list hands out for `name`
  mppassFor (name) {
    return crypto.createHash('md5').update(this.salt + name).digest('hex')
  }

  async beat () {
    const server = this.server
    const ev = server.events.fire('heartbeat', { params: this.params(), list: this })
    if (ev.cancelled) return
    try {
      const res = await fetch(this.listUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: ev.params.toString(),
        signal: AbortSignal.timeout(15000)
      })
      const body = (await res.text()).trim()
      if (body.startsWith('{') || !res.ok) {
        let err = body.slice(0, 200) || `HTTP ${res.status}`
        try {
          const json = JSON.parse(body)
          err = (json.errors && json.errors[0] && json.errors[0][0]) || json.error || err
        } catch (e) {}
        if (err !== this.lastError) {
          this.lastError = err
          server.log.warn(`Heartbeat to ${this.label} failed: ${err}`)
          if (/port/i.test(err)) server.log.warn(`Port ${server.port} does not seem to be open. You may need to port forward it.`)
        }
        return
      }
      this.lastError = null
      if (body && body !== this.url) {
        this.url = body
        server.log.info(`Server page on ${this.label}: &b${body}`)
        if (this.primary) {
          try { fs.writeFileSync(path.join(server.root, 'data', 'externalurl.txt'), body) } catch (err) {}
        }
      }
    } catch (err) {
      const msg = err.name === 'TimeoutError' ? 'timed out' : err.message
      if (msg !== this.lastError) {
        this.lastError = msg
        server.log.warn(`Heartbeat to ${this.label} failed: ${msg}`)
      }
    }
  }
}

function randomSalt (length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length]
  return out
}

// Checks a Minecraft account with Mojang's session server. BetaCraft clients call joinServer with
// serverId = sha1(the player's IP address) before connecting (same check as MCGalaxy's mojang-auth).
async function mojangHasJoined (name, ip, { fetchImpl = fetch } = {}) {
  const serverId = crypto.createHash('sha1').update(ip).digest('hex')
  const url = `https://sessionserver.mojang.com/session/minecraft/hasJoined?username=${encodeURIComponent(name)}&serverId=${serverId}`
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) })
  return res.status === 200
}

module.exports = { Heartbeat, randomSalt, mojangHasJoined }
