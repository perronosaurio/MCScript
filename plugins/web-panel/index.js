'use strict'

// Web administration panel: players, levels, live log and a console, in the browser.
// Disabled by default. Set "enabled": true in config/plugins/web-panel.json and /preload web-panel.
// It listens on 127.0.0.1 unless you change "host"; put it behind HTTPS if you expose it.

const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const LOG_LINES = 500

module.exports = {
  name: 'web-panel',
  version: '1.0.0',
  description: 'Browser admin panel (players, levels, logs, console)',
  author: 'MCScript',

  defaultConfig: {
    enabled: false,
    host: '127.0.0.1',
    port: 8080,
    token: ''
  },

  load (ctx) {
    const { server, config, log } = ctx
    if (!config.enabled) {
      log.info('Disabled. Edit config/plugins/web-panel.json to enable it.')
      return
    }
    if (!config.token) {
      config.token = crypto.randomBytes(18).toString('base64url')
      ctx.saveConfig()
    }

    const lines = []
    let seq = 0
    ctx.onUnload(server.log.subscribe(entry => {
      lines.push({ id: ++seq, ...entry })
      if (lines.length > LOG_LINES) lines.shift()
    }))

    const page = fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8')
    const tokenBuf = Buffer.from(config.token)
    const authorized = (req) => {
      const header = req.headers.authorization || ''
      const given = Buffer.from(header.replace(/^Bearer\s+/i, ''))
      return given.length === tokenBuf.length && crypto.timingSafeEqual(given, tokenBuf)
    }

    const json = (res, status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(body))
    }

    const readBody = (req) => new Promise((resolve, reject) => {
      let body = ''
      req.on('data', c => { body += c; if (body.length > 10000) req.destroy() })
      req.on('end', () => { try { resolve(JSON.parse(body || '{}')) } catch (err) { reject(err) } })
    })

    // Runs a command as the panel and returns what it printed
    const runCommand = async (line) => {
      const output = []
      const actor = server.createConsoleActor('WebPanel', m => { if (m) output.push(String(m)) })
      server.log.info(`[web panel] ${line}`)
      if (line.startsWith('/')) await server.commands.execute(actor, line)
      else server.broadcast(`&d[Panel]&f: ${server.text.sanitize(line)}`)
      return output
    }

    const status = () => ({
      name: server.config.name,
      motd: server.config.motd,
      version: server.version,
      uptime: Date.now() - server.startedAt,
      players: server.online.length,
      maxPlayers: server.config.maxPlayers,
      memoryMB: Math.round(process.memoryUsage().rss / 1048576),
      levels: server.levels.loaded.size,
      plugins: server.plugins.list().map(p => ({ name: p.name, version: p.module.version || null })),
      url: server.heartbeat.url
    })

    const players = () => server.online.map(p => ({
      name: p.name,
      rank: p.rank.name,
      color: p.color,
      level: p.level ? p.level.name : null,
      ip: p.ip,
      client: p.appName,
      ping: p.pingMs,
      afk: !!p.data['essentials.afk'],
      web: p.conn.isWebSocket,
      online: Date.now() - p.joinedAt
    }))

    const levels = () => server.levels.listFiles().map(name => {
      const l = server.levels.get(name)
      return l
        ? { name, loaded: true, size: [l.width, l.height, l.length], players: l.players.length, main: l === server.levels.main }
        : { name, loaded: false }
    })

    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://panel')
      try {
        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' })
          return res.end(page)
        }
        if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' })
        if (!authorized(req)) return json(res, 401, { error: 'invalid token' })

        if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, status())
        if (req.method === 'GET' && url.pathname === '/api/players') return json(res, 200, players())
        if (req.method === 'GET' && url.pathname === '/api/levels') return json(res, 200, levels())
        if (req.method === 'GET' && url.pathname === '/api/logs') {
          const since = Number(url.searchParams.get('since') || 0)
          return json(res, 200, lines.filter(l => l.id > since))
        }
        if (req.method === 'POST' && url.pathname === '/api/command') {
          const body = await readBody(req)
          const line = String(body.command || '').trim()
          if (!line) return json(res, 400, { error: 'empty command' })
          return json(res, 200, { output: await runCommand(line) })
        }
        return json(res, 404, { error: 'not found' })
      } catch (err) {
        log.error('Panel error:', err)
        json(res, 500, { error: err.message })
      }
    })

    httpServer.on('error', err => log.error(`Could not start the web panel on ${config.host}:${config.port}: ${err.message}`))
    httpServer.listen(config.port, config.host, () => {
      const addr = httpServer.address()
      log.info(`Web panel on http://${config.host}:${addr.port}/ (token in config/plugins/web-panel.json)`)
      module.exports.api.port = addr.port
    })
    ctx.onUnload(() => httpServer.close())
    module.exports.api = { port: null }
  }
}
