'use strict'

// Two-way chat bridge between the server and an IRC channel.
// Disabled by default: set "enabled": true in config/plugins/relay-irc.json and /preload relay-irc.

const net = require('net')
const tls = require('tls')

module.exports = {
  name: 'relay-irc',
  version: '1.0.0',
  description: 'Relays chat to and from an IRC channel',
  author: 'MCScript',

  defaultConfig: {
    enabled: false,
    host: 'irc.libera.chat',
    port: 6697,
    tls: true,
    nick: 'MCScriptBot',
    password: '',
    channel: '#my-classicube-server',
    ircPrefix: '&5[IRC] ',
    relayJoins: true
  },

  load (ctx) {
    const { server, config, log, text } = ctx
    if (!config.enabled) {
      log.info('Disabled. Edit config/plugins/relay-irc.json to enable it.')
      return
    }

    let socket = null
    let buffer = ''
    let connected = false
    let stopping = false
    let reconnectTimer = null

    const send = (line) => { if (socket && !socket.destroyed) socket.write(line + '\r\n') }
    const say = (msg) => { if (connected) send(`PRIVMSG ${config.channel} :${text.stripColors(msg).slice(0, 400)}`) }

    const connect = () => {
      buffer = ''
      const opts = { host: config.host, port: config.port }
      socket = config.tls ? tls.connect({ ...opts, servername: config.host }) : net.connect(opts)
      socket.setEncoding('utf8')
      socket.on('connect', () => {
        if (config.tls) return
        register()
      })
      socket.on('secureConnect', register)
      socket.on('data', onData)
      socket.on('error', err => log.warn(`IRC error: ${err.message}`))
      socket.on('close', () => {
        connected = false
        if (!stopping) {
          log.warn('IRC connection closed, reconnecting in 30s')
          reconnectTimer = ctx.setTimeout(connect, 30000)
        }
      })
    }

    const register = () => {
      if (config.password) send(`PASS ${config.password}`)
      send(`NICK ${config.nick}`)
      send(`USER ${config.nick} 0 * :MCScript relay`)
    }

    const onData = (chunk) => {
      buffer += chunk
      const lines = buffer.split('\r\n')
      buffer = lines.pop()
      for (const line of lines) handle(line)
    }

    const handle = (line) => {
      const m = line.match(/^(?::(\S+) )?(\S+)(?: (.*))?$/)
      if (!m) return
      const [, prefix, command, rest = ''] = m
      const nick = prefix ? prefix.split('!')[0] : ''
      const trailing = rest.includes(' :') ? rest.slice(rest.indexOf(' :') + 2) : rest.startsWith(':') ? rest.slice(1) : ''
      switch (command) {
        case 'PING': send(`PONG ${rest}`); break
        case '001':
          connected = true
          send(`JOIN ${config.channel}`)
          log.info(`Connected to ${config.host}, joining ${config.channel}`)
          break
        case '433': // nick in use
          config.nick += '_'
          send(`NICK ${config.nick}`)
          break
        case 'PRIVMSG': {
          const target = rest.split(' ')[0]
          if (target.toLowerCase() !== config.channel.toLowerCase()) return
          // eslint-disable-next-line no-control-regex
          const action = trailing.match(/^\x01ACTION (.*)\x01$/)
          // eslint-disable-next-line no-control-regex
          const msg = text.sanitize((action ? action[1] : trailing).replace(/[\x00-\x1f]/g, ''))
          if (msg.trim() === '.who' || msg.trim() === '!players') {
            const names = server.online.filter(p => !p.hidden).map(p => p.name)
            say(`Online (${names.length}): ${names.join(', ') || 'nobody'}`)
            return
          }
          server.broadcast(action ? `${config.ircPrefix}&f* ${nick} ${msg}` : `${config.ircPrefix}&f${nick}: ${msg}`)
          break
        }
      }
    }

    ctx.on('playerChat', (ev) => { if (!ev.cancelled) say(`<${ev.player.name}> ${ev.message}`) }, { priority: 'monitor' })
    if (config.relayJoins) {
      ctx.on('playerJoin', ({ player }) => say(`${player.name} joined the game`), { priority: 'monitor' })
      ctx.on('playerLeave', ({ player }) => { if (player.loggedIn) say(`${player.name} left the game`) }, { priority: 'monitor' })
    }

    connect()
    ctx.onUnload(() => {
      stopping = true
      if (reconnectTimer) ctx.clearTimer(reconnectTimer)
      send('QUIT :Server stopping')
      if (socket) socket.end()
    })

    module.exports.api = { say }
  }
}
