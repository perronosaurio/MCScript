'use strict'

// Discord bot, along the lines of MCGalaxy's:
//  - chat channels: in-game chat goes there and messages from there show up in game
//  - staff channels: linked to the in-game staff chat (/opchat, #message)
//  - commands: "!command args" runs a server command. Everyone can use the ones in publicCommands;
//    other commands need a Discord role or user that is mapped to a server rank (roleRanks, userRanks),
//    or being in a staff channel (staffRank).
//  - "!players" (also .who and .players, like MCGalaxy) lists who is online.
// Needs a bot with the "Message Content" intent. See docs/DISCORD.md.
// Disabled by default: set "enabled": true in config/plugins/relay-discord.json and /preload relay-discord.

const { Gateway } = require('./gateway')

const API = 'https://discord.com/api/v10'
const MAX_MESSAGE = 1900

module.exports = {
  name: 'relay-discord',
  version: '2.0.0',
  description: 'Discord bot: chat bridge, staff channel and commands',
  author: 'MCScript',

  defaultConfig: {
    enabled: false,
    botToken: '',
    chatChannelIds: [],
    staffChannelIds: [],
    commandPrefix: '!',
    publicCommands: ['players', 'serverinfo', 'rules', 'levels', 'whois', 'top', 'baltop', 'faq', 'news'],
    staffRank: 'Operator',
    roleRanks: {},
    userRanks: {},
    bannedCommands: ['pinstall', 'puninstall', 'pcreate'],
    ignoredUserIds: [],
    useNicknames: true,
    relayJoins: true,
    relayStaffChat: true,
    status: 'with {players}/{max} players',
    inviteUrl: '',
    discordPrefix: '&9[Discord] ',
    webhookUrl: ''
  },

  load (ctx) {
    const { server, config, log, text } = ctx
    const ranks = server.ranks

    if (config.inviteUrl) {
      ctx.command({
        name: 'discord',
        category: 'other',
        usage: '/discord',
        description: 'Shows the link to our Discord server',
        run (player) { player.message(`&eJoin us on Discord: &f${config.inviteUrl}`) }
      })
    }

    if (!config.enabled) {
      log.info('Disabled. Edit config/plugins/relay-discord.json to enable it.')
      return
    }
    // 1.x config had a single channelId
    const chatChannels = [...new Set([...(config.chatChannelIds || []), config.channelId].filter(Boolean).map(String))]
    const staffChannels = (config.staffChannelIds || []).map(String)
    if (!config.botToken && !config.webhookUrl) {
      log.warn('Set botToken (and chatChannelIds) in config/plugins/relay-discord.json')
      return
    }

    // outgoing

    // Lines are grouped per channel and sent together, which keeps well under Discord's rate limits
    const pending = new Map() // channelId -> [lines]
    let flushing = false
    let flushTimer = null

    const post = async (url, body, webhook = false) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const headers = { 'Content-Type': 'application/json' }
        if (!webhook) headers.Authorization = `Bot ${config.botToken}`
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }) })
        if (res.status !== 429) {
          if (!res.ok) log.warn(`Discord answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
          return
        }
        const info = await res.json().catch(() => ({}))
        await new Promise(resolve => setTimeout(resolve, (info.retry_after || 1) * 1000))
      }
    }

    const flush = async () => {
      flushTimer = null
      if (flushing) return
      flushing = true
      try {
        for (const [channel, lines] of pending) {
          pending.delete(channel)
          for (const chunk of chunks(lines)) {
            if (channel === 'webhook') await post(config.webhookUrl, { content: chunk, username: text.stripColors(server.config.name).slice(0, 32) }, true)
            else await post(`${API}/channels/${channel}/messages`, { content: chunk })
          }
        }
      } catch (err) {
        log.warn(`Could not send to Discord: ${err.message}`)
      } finally {
        flushing = false
        if (pending.size) schedule()
      }
    }
    const schedule = () => { if (!flushTimer) flushTimer = ctx.setTimeout(flush, 300) }

    const sendTo = (channels, line) => {
      for (const channel of channels) {
        const lines = pending.get(channel) || []
        if (lines.length < 100) lines.push(line)
        pending.set(channel, lines)
      }
      schedule()
    }
    const toChat = line => sendTo(config.botToken ? chatChannels : ['webhook'], line)
    const toStaff = line => { if (config.botToken) sendTo(staffChannels, line) }

    const clean = msg => escapeMarkdown(text.stripColors(String(msg))).slice(0, 500)
    const countLine = () => `(${server.online.filter(p => !p.hidden).length}/${server.config.maxPlayers})`

    ctx.on('playerChat', (ev) => {
      if (!ev.cancelled) toChat(`**${clean(ev.player.name)}**: ${clean(ev.message)}`)
    }, { priority: 'monitor' })
    if (config.relayJoins) {
      ctx.on('playerJoin', ({ player }) => { if (!player.hidden) toChat(`**${clean(player.name)}** joined the game ${countLine()}`) }, { priority: 'monitor' })
      ctx.on('playerLeave', ({ player }) => {
        if (player.loggedIn && !player.hidden) ctx.setTimeout(() => toChat(`**${clean(player.name)}** left the game ${countLine()}`), 0)
      }, { priority: 'monitor' })
    }
    if (config.relayStaffChat) {
      ctx.on('staffChat', ({ sender, message, channel }) => {
        if (!sender.fromDiscord) toStaff(`[${channel === 'admin' ? 'Admin' : 'Op'}] **${clean(sender.name)}**: ${clean(message)}`)
      }, { priority: 'monitor' })
    }
    ctx.on('serverStart', () => toChat('Server started'), { priority: 'monitor' })

    // incoming

    if (!config.botToken) return // webhook only: nothing comes back
    if (typeof globalThis.WebSocket === 'undefined') {
      log.warn('This Node.js version has no WebSocket client, so messages from Discord are not received.')
      return
    }

    const presence = () => ({
      since: null,
      afk: false,
      status: 'online',
      activities: config.status
        ? [{ type: 0, name: config.status.replace('{players}', server.online.filter(p => !p.hidden).length).replace('{max}', server.config.maxPlayers) }]
        : []
    })
    const gateway = new Gateway({ token: config.botToken, presence: presence() })
    gateway.on('ready', user => log.info(`Connected to Discord as ${user.username}`))
    gateway.on('fatal', reason => log.error(reason))
    gateway.on('log', (level, msg) => log[level](msg))
    gateway.on('message', d => {
      try { onMessage(d) } catch (err) { log.error('Error handling a Discord message:', err) }
    })
    ctx.onUnload(() => gateway.stop())
    gateway.connect()

    // presence changes are rate limited by Discord, so at most one every 20 seconds
    let presenceTimer = null
    const updatePresence = () => {
      if (presenceTimer || !config.status) return
      presenceTimer = ctx.setTimeout(() => { presenceTimer = null; gateway.setPresence(presence()) }, 20000)
    }
    ctx.on('playerJoin', updatePresence, { priority: 'monitor' })
    ctx.on('playerLeave', updatePresence, { priority: 'monitor' })

    const lastReply = new Map() // throttles !players and error replies
    const throttled = (key, seconds) => {
      const now = Date.now()
      if ((lastReply.get(key) || 0) > now - seconds * 1000) return true
      lastReply.set(key, now)
      return false
    }

    // Highest server rank the Discord user has through userRanks / roleRanks (null if none)
    const mappedRank = (d) => {
      const names = [config.userRanks[d.author.id], ...((d.member && d.member.roles) || []).map(r => config.roleRanks[r])]
      let best = null
      for (const name of names) {
        const rank = name && ranks.get(name)
        if (rank && (!best || rank.permission > best.permission)) best = rank
      }
      return best
    }

    const displayName = d => text.sanitize(text.stripColors(
      (config.useNicknames && d.member && d.member.nick) || d.author.global_name || d.author.username
    )).slice(0, 32)

    // Discord markup -> plain text for the game
    const plain = (d) => {
      let content = d.content || ''
      for (const u of d.mentions || []) content = content.replace(new RegExp(`<@!?${u.id}>`, 'g'), `@${u.global_name || u.username}`)
      content = content
        .replace(/<@&\d+>/g, '@role')
        .replace(/<#\d+>/g, '#channel')
        .replace(/<a?(:\w+:)\d+>/g, '$1')
        .replace(/\s*\n\s*/g, ' ')
      if (d.attachments && d.attachments.length) content += ' [attachment]'
      if (d.sticker_items && d.sticker_items.length) content += ' [sticker]'
      return text.sanitize(content).trim().slice(0, 300)
    }

    const reply = (channel, lines) => sendTo([channel], lines)

    const listPlayers = (channel, staff) => {
      const shown = server.online.filter(p => staff || !p.hidden)
      const names = shown.map(p => clean(p.name) + (staff ? ` (${p.level ? p.level.name : '?'}${p.hidden ? ', hidden' : ''})` : ''))
      reply(channel, `**Online ${countLine()}:** ${names.join(', ') || 'nobody'}`)
    }

    const runCommand = async (d, channel, staff, line) => {
      const label = line.split(/\s+/)[0]
      const cmd = server.commands.find(label)
      if (!cmd) {
        if (!throttled('unknown:' + d.author.id, 10)) reply(channel, `Unknown command \`${escapeMarkdown(label)}\`.`)
        return
      }
      if (config.bannedCommands.some(b => b.toLowerCase() === cmd.name)) {
        return reply(channel, `\`${cmd.name}\` can't be used from Discord.`)
      }
      const isPublic = config.publicCommands.some(c => c.toLowerCase() === cmd.name)
      let rank = mappedRank(d)
      if (staff && config.staffRank) {
        const staffRank = ranks.get(config.staffRank)
        if (staffRank && (!rank || staffRank.permission > rank.permission)) rank = staffRank
      }
      if (!rank && !isPublic) {
        if (!throttled('denied:' + d.author.id, 30)) reply(channel, `You don't have permission to use \`${cmd.name}\` from Discord.`)
        return
      }
      if (!rank) rank = ranks.default

      const name = displayName(d)
      const output = []
      const actor = server.createConsoleActor(`(Discord) ${name}`, m => { if (m) output.push(text.stripColors(String(m))) }, { rank, color: '&9' })
      actor.fromDiscord = true
      log.info(`${name} (Discord, ${rank.name}) used ${config.commandPrefix}${line}`)
      await server.commands.execute(actor, '/' + line)
      if (!output.length) output.push('Done.')
      for (const chunk of chunks(output, true)) reply(channel, chunk)
    }

    const onMessage = (d) => {
      if (!d.author || d.author.bot || d.webhook_id) return
      if (gateway.user && d.author.id === gateway.user.id) return
      if (config.ignoredUserIds.includes(d.author.id)) return
      const channel = d.channel_id
      const staff = staffChannels.includes(channel)
      if (!staff && !chatChannels.includes(channel)) return

      const raw = (d.content || '').trim()
      const lower = raw.toLowerCase()
      if (['.who', '.players', `${config.commandPrefix}players`, `${config.commandPrefix}who`].includes(lower)) {
        if (!throttled('who:' + channel, 5)) listPlayers(channel, staff)
        return
      }
      if (config.commandPrefix && raw.startsWith(config.commandPrefix) && raw.length > config.commandPrefix.length) {
        runCommand(d, channel, staff, raw.slice(config.commandPrefix.length).trim()).catch(err => log.error('Discord command failed:', err))
        return
      }

      const message = plain(d)
      if (!message) return
      const name = displayName(d)
      if (staff) {
        const perm = ranks.permissionOf('Operator')
        server.broadcast(`&c[Op] &9(Discord) ${name}&c: &f${message}`, p => p.permission >= perm)
        server.log.info(`[Op] (Discord) ${name}: ${message}`)
      } else {
        server.broadcast(`${config.discordPrefix}&f${name}: ${message}`)
        server.log.info(`(Discord) ${name}: ${message}`)
      }
    }

    module.exports.api = { gateway, handleMessage: onMessage }
  }
}

function escapeMarkdown (s) {
  return s.replace(/([*_~`|>\\])/g, '\\$1').replace(/@(everyone|here)/g, '@\u200b$1')
}

// Joins lines into messages under Discord's 2000 character limit (optionally as code blocks)
function chunks (lines, code = false) {
  const out = []
  let cur = ''
  const limit = code ? MAX_MESSAGE - 8 : MAX_MESSAGE
  for (let line of lines) {
    if (code) line = line.replace(/```/g, "'''")
    if (line.length > limit) line = line.slice(0, limit)
    if (cur && cur.length + line.length + 1 > limit) { out.push(cur); cur = '' }
    cur = cur ? cur + '\n' + line : line
  }
  if (cur) out.push(cur)
  return code ? out.map(c => '```\n' + c + '\n```') : out
}

module.exports.chunks = chunks
