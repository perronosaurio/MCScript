'use strict'

// Announces the server on the ClassiCube server list (classicube.net).
class Heartbeat {
  constructor (server) {
    this.server = server
    this.timer = null
    this.url = null
    this.lastError = null
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
      name: cfg.name,
      port: String(s.port),
      users: String(s.online.filter(p => !p.hidden).length),
      max: String(cfg.maxPlayers),
      public: cfg.public ? 'True' : 'False',
      salt: s.salt,
      software: `&bMCScript &f${s.version}`,
      web: cfg.allowWebClient ? 'True' : 'False',
      version: '7'
    })
  }

  async beat () {
    const server = this.server
    const ev = server.events.fire('heartbeat', { params: this.params() })
    if (ev.cancelled) return
    try {
      const res = await fetch(server.config.heartbeatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: ev.params.toString(),
        signal: AbortSignal.timeout(15000)
      })
      const body = (await res.text()).trim()
      if (body.startsWith('{')) {
        const json = JSON.parse(body)
        const err = json.errors && json.errors[0] && json.errors[0][0]
        if (err && err !== this.lastError) {
          this.lastError = err
          server.log.warn(`Heartbeat error: ${err}`)
          if (/port/i.test(err)) server.log.warn(`Port ${server.port} does not seem to be open. You may need to port forward it.`)
        }
        return
      }
      this.lastError = null
      if (body && body !== this.url) {
        this.url = body
        server.log.info(`Server list URL: &b${body}`)
        try {
          require('fs').writeFileSync(require('path').join(server.root, 'data', 'externalurl.txt'), body)
        } catch (err) {}
      }
    } catch (err) {
      const msg = err.name === 'TimeoutError' ? 'timed out' : err.message
      if (msg !== this.lastError) {
        this.lastError = msg
        server.log.warn(`Heartbeat failed: ${msg}`)
      }
    }
  }
}

module.exports = { Heartbeat }
