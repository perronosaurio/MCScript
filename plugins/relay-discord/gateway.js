'use strict'

const { EventEmitter } = require('events')

const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json'
// GUILDS, GUILD_MESSAGES and MESSAGE_CONTENT (the last one must be switched on in the Developer Portal)
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15)

// Close codes after which reconnecting is pointless
const FATAL = {
  4004: 'the bot token is wrong',
  4010: 'invalid shard',
  4011: 'the bot is in too many servers and needs sharding',
  4012: 'invalid API version',
  4013: 'invalid intents',
  4014: 'the Message Content intent is not enabled. Turn it on in the Discord Developer Portal (Bot > Privileged Gateway Intents)'
}

// Minimal Discord gateway client: identify, heartbeat, resume and presence. Emits 'ready', 'message' (MESSAGE_CREATE data),
// 'fatal' (reason) and 'log' (level, text).
class Gateway extends EventEmitter {
  constructor ({ token, url = null, WebSocketImpl = globalThis.WebSocket, presence = null, fetch = null }) {
    super()
    this.token = token
    // Discord asks apps to get the gateway address from GET /gateway/bot and cache it; without a fetch
    // function (or if that fails) the documented default address is used
    this.url = url
    this.fetch = fetch
    this.WebSocket = WebSocketImpl
    this.presence = presence
    this.ws = null
    this.seq = null
    this.sessionId = null
    this.resumeUrl = null
    this.heartbeat = null
    this.acked = true
    this.stopped = false
    this.user = null
    this.retryDelay = 5000
  }

  async _gatewayUrl () {
    if (this.url) return this.url
    if (this.fetch) {
      try {
        const res = await this.fetch('https://discord.com/api/v10/gateway/bot', { headers: { Authorization: `Bot ${this.token}` } })
        if (res.status === 401) {
          this.stopped = true
          this.emit('fatal', `Discord closed the connection: ${FATAL[4004]} (code 4004)`)
          return null
        }
        const body = res.ok ? await res.json() : null
        if (body && typeof body.url === 'string' && body.url.startsWith('wss://')) {
          this.url = `${body.url}/?v=10&encoding=json`
          return this.url
        }
      } catch (err) {
        this.emit('log', 'debug', `Could not get the Discord gateway address: ${err.message}`)
      }
    }
    return GATEWAY
  }

  connect (resume = false) {
    if (this.stopped) return
    if (!(resume && this.resumeUrl) && !this.url) {
      this._gatewayUrl().then(url => { if (url) { this.url = this.url || url; this.connect(resume) } })
      return
    }
    const url = resume && this.resumeUrl ? `${this.resumeUrl}/?v=10&encoding=json` : this.url
    let ws
    try {
      ws = this.ws = new this.WebSocket(url)
    } catch (err) {
      this.emit('log', 'warn', `Could not connect to Discord: ${err.message}`)
      return this._onClose({ code: 0 })
    }
    ws.onmessage = (event) => {
      let msg
      try { msg = JSON.parse(event.data) } catch (err) { return }
      this._onPacket(msg, resume)
    }
    ws.onclose = (event) => this._onClose(event)
    ws.onerror = () => {} // onclose follows and handles it
  }

  send (op, d) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ op, d }))
  }

  setPresence (presence) {
    this.presence = presence
    this.send(3, presence)
  }

  stop () {
    this.stopped = true
    clearInterval(this.heartbeat)
    clearTimeout(this.firstBeat)
    if (this.ws) try { this.ws.close(1000) } catch (err) {}
  }

  _onPacket (msg, resume) {
    if (msg.s !== null && msg.s !== undefined) this.seq = msg.s
    switch (msg.op) {
      case 10: { // hello
        const interval = msg.d.heartbeat_interval
        clearInterval(this.heartbeat)
        clearTimeout(this.firstBeat)
        this.acked = true
        const beat = () => {
          // no ack since the last beat: the connection is dead even if the socket looks open
          if (!this.acked) return this._reconnect(true)
          this.acked = false
          this.send(1, this.seq)
        }
        this.firstBeat = later(() => { beat(); this.heartbeat = setInterval(beat, interval).unref() }, interval * Math.random())
        if (resume && this.sessionId) {
          this.send(6, { token: this.token, session_id: this.sessionId, seq: this.seq })
        } else {
          this.send(2, {
            token: this.token,
            intents: INTENTS,
            properties: { os: process.platform, browser: 'mcscript', device: 'mcscript' },
            presence: this.presence || undefined
          })
        }
        break
      }
      case 11: this.acked = true; break // heartbeat ack
      case 1: this.send(1, this.seq); break // heartbeat requested
      case 7: this._reconnect(true); break // reconnect requested
      case 9: // invalid session: resumable only if d is true
        if (!msg.d) { this.sessionId = null; this.seq = null }
        later(() => this._reconnect(!!msg.d), 1000 + Math.random() * 4000)
        break
      case 0:
        if (msg.t === 'READY') {
          this.sessionId = msg.d.session_id
          this.resumeUrl = msg.d.resume_gateway_url
          this.user = msg.d.user
          this.retryDelay = 5000
          this.emit('ready', msg.d.user)
        } else if (msg.t === 'RESUMED') {
          this.retryDelay = 5000
          this.emit('log', 'debug', 'Discord session resumed')
        } else if (msg.t === 'MESSAGE_CREATE') {
          this.emit('message', msg.d)
        }
        break
    }
  }

  _reconnect (resume) {
    const old = this.ws
    this.ws = null
    if (old) {
      old.onclose = null
      try { old.close(4000) } catch (err) {}
    }
    clearInterval(this.heartbeat)
    clearTimeout(this.firstBeat)
    this.connect(resume)
  }

  _onClose (event) {
    clearInterval(this.heartbeat)
    clearTimeout(this.firstBeat)
    if (this.stopped) return
    const code = event && event.code
    if (FATAL[code]) {
      this.stopped = true
      return this.emit('fatal', `Discord closed the connection: ${FATAL[code]} (code ${code})`)
    }
    // invalid sequence or a timed out session can't be resumed: start a new one
    if (code === 4007 || code === 4009) { this.sessionId = null; this.seq = null; this.resumeUrl = null }
    this.emit('log', 'warn', `Discord connection closed (code ${code}), reconnecting in ${this.retryDelay / 1000}s`)
    later(() => this.connect(!!this.sessionId), this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, 120000)
  }
}

// timers that don't keep the process alive on shutdown
function later (fn, ms) {
  const t = setTimeout(fn, ms)
  if (t.unref) t.unref()
  return t
}

module.exports = { Gateway, INTENTS }
