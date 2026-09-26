'use strict'

/* global WebSocket */

// Two-way chat bridge with a Discord channel.
//  - Outgoing only: set "webhookUrl" (Channel settings > Integrations > Webhooks).
//  - Two-way: set "botToken" and "channelId" (needs Node 22+ and the "Message Content" intent enabled for the bot).
// Disabled by default: set "enabled": true in config/plugins/relay-discord.json and /preload relay-discord.

const API = 'https://discord.com/api/v10'
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json'
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15) // GUILDS, GUILD_MESSAGES, MESSAGE_CONTENT

module.exports = {
  name: 'relay-discord',
  version: '1.0.0',
  description: 'Relays chat to and from Discord',
  author: 'MCScript',

  defaultConfig: {
    enabled: false,
    webhookUrl: '',
    botToken: '',
    channelId: '',
    discordPrefix: '&9[Discord] ',
    relayJoins: true,
    avatarUrl: 'https://cdn.classicube.net/face/{name}.png'
  },

  load (ctx) {
    const { server, config, log, text } = ctx
    if (!config.enabled) {
      log.info('Disabled. Edit config/plugins/relay-discord.json to enable it.')
      return
    }
    if (!config.webhookUrl && !(config.botToken && config.channelId)) {
      log.warn('Set webhookUrl, or botToken + channelId, in config/plugins/relay-discord.json')
      return
    }

    const clean = msg => text.stripColors(msg).replace(/([*_~`|>\\])/g, '\\$1').slice(0, 1900)
    const queue = []
    let sending = false

    // Messages are sent one at a time to respect Discord's rate limits
    const flush = async () => {
      if (sending) return
      sending = true
      while (queue.length) {
        const { name, content } = queue.shift()
        try {
          let res
          if (config.webhookUrl) {
            res = await fetch(config.webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: name || server.config.name.slice(0, 32),
                avatar_url: name ? config.avatarUrl.replace('{name}', encodeURIComponent(name)) : undefined,
                content,
                allowed_mentions: { parse: [] }
              })
            })
          } else {
            res = await fetch(`${API}/channels/${config.channelId}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bot ${config.botToken}` },
              body: JSON.stringify({ content: name ? `**${name}**: ${content}` : content, allowed_mentions: { parse: [] } })
            })
          }
          if (res.status === 429) {
            const retry = Number(res.headers.get('retry-after') || 1)
            queue.unshift({ name, content })
            await new Promise(resolve => setTimeout(resolve, retry * 1000))
          } else if (!res.ok) {
            log.warn(`Discord responded ${res.status}: ${(await res.text()).slice(0, 200)}`)
          }
        } catch (err) {
          log.warn(`Could not send to Discord: ${err.message}`)
        }
      }
      sending = false
    }

    const send = (name, content) => {
      if (queue.length > 50) queue.shift()
      queue.push({ name, content })
      flush()
    }

    ctx.on('playerChat', (ev) => { if (!ev.cancelled) send(ev.player.name, clean(ev.message)) }, { priority: 'monitor' })
    if (config.relayJoins) {
      ctx.on('playerJoin', ({ player }) => send(null, `**${clean(player.name)}** joined the game`), { priority: 'monitor' })
      ctx.on('playerLeave', ({ player }) => { if (player.loggedIn) send(null, `**${clean(player.name)}** left the game`) }, { priority: 'monitor' })
    }
    ctx.on('serverStart', () => send(null, 'Server started'), { priority: 'monitor' })

    // incoming (gateway)

    if (!config.botToken || !config.channelId) return
    if (typeof WebSocket === 'undefined') {
      log.warn('Receiving messages from Discord needs Node 22 or newer (global WebSocket). Only sending is enabled.')
      return
    }

    let ws = null
    let heartbeat = null
    let seq = null
    let stopping = false

    const connect = () => {
      ws = new WebSocket(GATEWAY)
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.s !== null && msg.s !== undefined) seq = msg.s
        switch (msg.op) {
          case 10: // hello
            clearInterval(heartbeat)
            heartbeat = setInterval(() => ws.send(JSON.stringify({ op: 1, d: seq })), msg.d.heartbeat_interval)
            ws.send(JSON.stringify({
              op: 2,
              d: { token: config.botToken, intents: INTENTS, properties: { os: process.platform, browser: 'mcscript', device: 'mcscript' } }
            }))
            break
          case 7: // reconnect
          case 9: // invalid session
            ws.close()
            break
          case 0:
            if (msg.t === 'READY') log.info(`Connected to Discord as ${msg.d.user.username}`)
            if (msg.t === 'MESSAGE_CREATE') onMessage(msg.d)
            break
        }
      }
      ws.onclose = () => {
        clearInterval(heartbeat)
        if (!stopping) setTimeout(() => { if (!stopping) connect() }, 10000)
      }
      ws.onerror = (err) => log.warn(`Discord gateway error: ${err.message || err.type}`)
    }

    const onMessage = (d) => {
      if (d.channel_id !== config.channelId || d.author.bot || d.webhook_id) return
      const name = (d.member && d.member.nick) || d.author.global_name || d.author.username
      let content = d.content || ''
      if (d.attachments && d.attachments.length) content += ' [attachment]'
      content = text.sanitize(content.replace(/\n/g, ' ').replace(/<a?(:\w+:)\d+>/g, '$1'))
      if (content.trim() === '!players') {
        const names = server.online.filter(p => !p.hidden).map(p => p.name)
        return send(null, `Online (${names.length}/${server.config.maxPlayers}): ${names.join(', ') || 'nobody'}`)
      }
      if (content.trim()) server.broadcast(`${config.discordPrefix}&f${text.stripColors(name)}: ${content}`)
    }

    connect()
    ctx.onUnload(() => {
      stopping = true
      clearInterval(heartbeat)
      if (ws) ws.close()
    })
  }
}
