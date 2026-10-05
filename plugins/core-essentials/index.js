'use strict'

// Everyday commands: teleporting, private messages, player info, models, nicknames, AFK...

const AFK_KEY = 'essentials.afk'

module.exports = {
  name: 'core-essentials',
  version: '2.0.0',
  description: 'Basic commands every server needs',
  author: 'MCScript',

  defaultConfig: {
    autoAfkMinutes: 5,
    allowedModels: ['humanoid', 'chicken', 'creeper', 'pig', 'sheep', 'skeleton', 'spider', 'zombie', 'sit', 'head', 'chibi', 'giant', 'corpse', 'sheep_nofur', 'block'],
    modelRank: 'Guest',
    anyModelRank: 'Operator'
  },

  load (ctx) {
    const { server, config, text, CommandError } = ctx
    const lastWhisper = new Map() // player name -> name of last person who messaged them

    const find = (player, name) => {
      if (!name) throw new CommandError('You need to specify a player.')
      const target = server.findPlayer(name, player)
      if (!target) throw new CommandError('Player not found.')
      return target
    }

    const isAfk = p => !!p.data[AFK_KEY]
    const setAfk = (p, afk, reason) => {
      if (isAfk(p) === afk) return
      p.data[AFK_KEY] = afk ? { since: Date.now(), reason } : null
      server.broadcast(afk ? `&7- ${p.coloredName} &7is AFK${reason ? ' (' + reason + ')' : ''}` : `&7- ${p.coloredName} &7is no longer AFK`)
      server.tabList.update(p)
    }

    // teleporting

    ctx.command({
      name: 'spawn',
      category: 'essentials',
      usage: '/spawn',
      description: 'Teleports you to the spawn of the level',
      inGame: true,
      run (player) {
        const s = player.level.spawn
        player.teleport(s.x, s.y, s.z, s.yaw, s.pitch)
      }
    })

    ctx.command({
      name: 'main',
      category: 'essentials',
      usage: '/main [level]',
      description: 'Takes you to the main level. Admins can pick another main level with /main <level>',
      help: ['The main level is where players arrive when they join. It is saved in config/server.json.'],
      run (player, args) {
        if (args[0]) {
          if (player.permission < server.ranks.permissionOf('Admin')) throw new CommandError('Only admins can change the main level.')
          const name = server.levels.resolveName(args[0])
          if (!name) throw new CommandError(`There is no level called ${args[0]}.`)
          const level = server.levels.setMain(name)
          return server.broadcast(`&e${level.name} is now the main level.`, p => p.permission >= server.ranks.permissionOf('Admin') || p === player)
        }
        if (player.isConsole) return player.message(`&eThe main level is &f${server.levels.main.name}&e.`)
        if (player.level === server.levels.main) {
          const s = player.level.spawn
          return player.teleport(s.x, s.y, s.z, s.yaw, s.pitch)
        }
        player.changeLevel(server.levels.main)
      }
    })

    ctx.command({
      name: 'tp',
      aliases: ['teleport', 'move'],
      category: 'essentials',
      rank: 'Builder',
      usage: '/tp <player> | /tp <x> <y> <z>',
      description: 'Teleports you to a player or coordinates',
      inGame: true,
      run (player, args, { usage }) {
        if (args.length === 3 && args.every(a => /^~?-?\d+(\.\d+)?$/.test(a) || a === '~')) {
          const cur = player.feetPos
          const [x, y, z] = args.map((a, i) => {
            const base = [cur.x, cur.y, cur.z][i]
            if (a.startsWith('~')) return base + (Number(a.slice(1)) || 0)
            return Number(a) + (i === 1 ? 0 : 0.5)
          })
          return player.teleport(x, y, z)
        }
        if (args.length !== 1) return usage()
        const target = find(player, args[0])
        if (target === player) throw new CommandError('You are already here.')
        if (player.teleportTo(target)) player.message(`&eTeleported to ${target.coloredName}&e.`)
      }
    })

    ctx.command({
      name: 'tphere',
      aliases: ['summon', 's'],
      category: 'essentials',
      rank: 'Operator',
      usage: '/tphere <player|all>',
      description: 'Brings a player to you',
      inGame: true,
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const targets = args[0].toLowerCase() === 'all' ? server.online.filter(p => p !== player) : [find(player, args[0])]
        for (const target of targets) {
          if (target.permission > player.permission) { player.message(`&cYou can't summon ${target.coloredName}&c.`); continue }
          if (target.teleportTo(player)) target.message(`&eYou were summoned by ${player.coloredName}&e.`)
        }
      }
    })

    // chat

    const whisper = (from, to, msg) => {
      if (to.data.ignoring && to.data.ignoring.has(from.name.toLowerCase())) return from.message(`&c${to.name} is ignoring you.`)
      from.message(`&9[&fme &9-> ${to.coloredName}&9] &f${msg}`)
      to.message(`&9[${from.coloredName} &9-> &fme&9] &f${msg}`)
      lastWhisper.set(to.name.toLowerCase(), from.name)
      ctx.log.info(`[PM] ${from.name} -> ${to.name}: ${msg}`)
    }

    ctx.command({
      name: 'msg',
      aliases: ['tell', 'whisper', 'w', 'pm'],
      category: 'chat',
      usage: '/msg <player> <message>',
      description: 'Sends a private message',
      run (player, args, { usage }) {
        if (args.length < 2) return usage()
        const target = find(player, args[0])
        whisper(player, target, text.sanitize(args.slice(1).join(' ')))
      }
    })

    ctx.command({
      name: 'reply',
      aliases: ['re'],
      category: 'chat',
      usage: '/reply <message>',
      description: 'Replies to the last private message you got',
      run (player, args, { usage }) {
        if (!args.length) return usage()
        const last = lastWhisper.get(player.name.toLowerCase())
        const target = last && server.findPlayerExact(last)
        if (!target) throw new CommandError('Nobody to reply to.')
        whisper(player, target, text.sanitize(args.join(' ')))
      }
    })

    ctx.command({
      name: 'ignore',
      category: 'chat',
      usage: '/ignore <player>',
      description: 'Stops receiving private messages from a player (toggle)',
      inGame: true,
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        player.data.ignoring = player.data.ignoring || new Set()
        const name = args[0].toLowerCase()
        if (player.data.ignoring.delete(name)) return player.message(`&eNo longer ignoring ${args[0]}.`)
        player.data.ignoring.add(name)
        player.message(`&eNow ignoring private messages from ${args[0]}.`)
      }
    })

    ctx.command({
      name: 'me',
      category: 'chat',
      usage: '/me <action>',
      description: 'Describes an action, e.g. /me waves',
      run (player, args, { usage }) {
        if (!args.length) return usage()
        server.broadcast(`&d* ${text.stripColors(player.coloredName)} ${text.sanitize(args.join(' '))}`)
      }
    })

    ctx.command({
      name: 'say',
      aliases: ['broadcast'],
      category: 'chat',
      rank: 'Operator',
      usage: '/say <message>',
      description: 'Broadcasts a message to everyone',
      run (player, args, { usage }) {
        if (!args.length) return usage()
        server.broadcast(text.convertPercentCodes(args.join(' ')))
      }
    })

    ctx.command({
      name: 'announce',
      category: 'chat',
      rank: 'Operator',
      usage: '/announce <message>',
      description: 'Shows a big message in the middle of everyone\'s screen',
      run (player, args, { usage }) {
        if (!args.length) return usage()
        const msg = text.convertPercentCodes(args.join(' '))
        server.broadcast(msg, null, 'announce')
      }
    })

    ctx.command({
      name: 'rules',
      category: 'essentials',
      usage: '/rules [player]',
      description: 'Shows the server rules',
      run (player, args) {
        const target = args[0] && player.permission >= server.ranks.permissionOf('Operator') ? find(player, args[0]) : player
        target.message('&eServer rules:')
        for (const line of server.config.rules || []) target.message(line)
        if (target !== player) player.message(`&eSent the rules to ${target.coloredName}&e.`)
      }
    })

    // information

    ctx.command({
      name: 'players',
      aliases: ['who', 'online', 'list'],
      category: 'essentials',
      usage: '/players',
      description: 'Lists the players online',
      run (player) {
        const visible = server.online.filter(p => !p.hidden || player.permission >= p.permission)
        player.message(`&eThere ${visible.length === 1 ? 'is' : 'are'} &f${visible.length}&e player${visible.length === 1 ? '' : 's'} online:`)
        for (const rank of [...server.ranks.all].reverse()) {
          const list = visible.filter(p => p.rank === rank)
          if (!list.length) continue
          player.message(`${rank.color}${rank.name}&7: ` + list.map(p => `${p.coloredName}${isAfk(p) ? '&7(afk)' : ''}${p.hidden ? '&7(hidden)' : ''}&7 (${p.level.name})`).join('&7, '))
        }
      }
    })

    ctx.command({
      name: 'whois',
      aliases: ['info', 'whowas', 'seen'],
      category: 'essentials',
      usage: '/whois [player]',
      description: 'Shows information about a player (online or not)',
      run (player, args) {
        const name = args[0] || player.name
        const online = server.matchPlayers(name)
        const record = online.length === 1 ? online[0].record : server.playerDB.find(name)
        if (!record) throw new CommandError(`No player named "${name}" has joined this server.`)
        const rank = server.ranks.get(record.rank) || server.ranks.default
        const onlinePlayer = server.findPlayerExact(record.name)
        player.message(`&e${rank.color}${record.name}&e ${onlinePlayer ? '&a(online)' : '&7(offline)'}`)
        if (record.nick) player.message(`&7  Nickname: &f${record.nick}`)
        if (record.pronouns) player.message(`&7  Pronouns: &f${record.pronouns}`)
        player.message(`&7  Rank: ${rank.color}${rank.name}`)
        if (onlinePlayer) {
          player.message(`&7  In level: &f${onlinePlayer.level.name}&7, using &f${onlinePlayer.appName}${onlinePlayer.pingMs !== null ? `&7, ping &f${onlinePlayer.pingMs}ms` : ''}`)
        } else {
          player.message(`&7  Last seen: &f${text.formatDuration(Date.now() - record.lastLogin)} ago`)
        }
        player.message(`&7  First joined: &f${new Date(record.firstLogin).toISOString().slice(0, 10)}&7, logins: &f${record.logins}`)
        const spent = record.timeSpent + (onlinePlayer ? Date.now() - onlinePlayer.joinedAt : 0)
        player.message(`&7  Time spent: &f${text.formatDuration(spent)}`)
        player.message(`&7  Blocks: &f${record.blocksPlaced}&7 placed, &f${record.blocksDeleted}&7 deleted; messages: &f${record.messages}`)
        if (record.ban) player.message(`&7  &cBanned&7 by ${record.ban.by}: ${record.ban.reason || 'no reason'}`)
        if (player.permission >= server.ranks.permissionOf('Admin')) player.message(`&7  IP: &f${record.lastIp}`)
      }
    })

    ctx.command({
      name: 'serverinfo',
      aliases: ['sinfo', 'version', 'about-server'],
      category: 'essentials',
      usage: '/serverinfo',
      description: 'Information about the server',
      run (player) {
        const up = text.formatDuration(Date.now() - server.startedAt)
        player.message(`&eThis server runs &bMCScript ${server.version}&e, a ClassiCube server written in JavaScript.`)
        player.message(`&7  Uptime: &f${up}&7, players: &f${server.online.length}/${server.config.maxPlayers}&7, levels loaded: &f${server.levels.loaded.size}`)
        player.message(`&7  Registered players: &f${server.playerDB.all().length}&7, plugins: &f${server.plugins.list().length}`)
        player.message(`&7  Node ${process.version}, memory ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`)
      }
    })

    ctx.command({
      name: 'ping',
      category: 'essentials',
      usage: '/ping [player]',
      description: 'Shows the connection latency',
      run (player, args) {
        const target = args[0] ? find(player, args[0]) : player
        if (target.isConsole) throw new CommandError('The console has no ping.')
        if (!target.supports('TwoWayPing')) throw new CommandError(`${target.name}'s client doesn't support measuring ping.`)
        player.message(target.pingMs === null ? '&eMeasuring... try again in a few seconds.' : `&e${target.name}'s ping: &f${target.pingMs}ms`)
      }
    })

    ctx.command({
      name: 'where',
      aliases: ['pos', 'coords'],
      category: 'essentials',
      usage: '/where [player]',
      description: 'Shows the position of a player',
      inGame: true,
      run (player, args) {
        const target = args[0] ? find(player, args[0]) : player
        const p = target.blockPos
        player.message(`&e${target.coloredName}&e is at &f${p.x} ${p.y} ${p.z}&e in &f${target.level.name}&e (yaw ${Math.round(target.yaw * 360 / 256)}, pitch ${Math.round(target.pitch * 360 / 256)})`)
      }
    })

    ctx.command({
      name: 'time',
      category: 'essentials',
      usage: '/time',
      description: 'Shows the server time',
      run (player) { player.message(`&eServer time: &f${new Date().toLocaleString()}`) }
    })

    // appearance

    ctx.command({
      name: 'model',
      aliases: ['setmodel'],
      category: 'essentials',
      rank: config.modelRank,
      usage: '/model <model> [player]  (models: chicken, creeper, pig, sit, block id...)',
      description: 'Changes how you (or another player) look',
      inGame: true,
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        let model = args[0].toLowerCase()
        let target = player
        if (args[1]) {
          if (player.permission < server.ranks.permissionOf('Operator')) throw new CommandError('Only operators can change other players\' models.')
          target = find(player, args[1])
        }
        const blockId = player.level.parseBlock(model)
        if (/^\d+$/.test(model) || (blockId !== null && !config.allowedModels.includes(model))) {
          if (blockId === null) throw new CommandError('Unknown block.')
          model = String(blockId)
        } else if (!config.allowedModels.includes(model.split('|')[0]) && player.permission < server.ranks.permissionOf(config.anyModelRank)) {
          throw new CommandError(`Allowed models: ${config.allowedModels.join(', ')}`)
        }
        target.setModel(model)
        player.message(`&eChanged ${target === player ? 'your' : target.name + '\'s'} model to &f${model}&e.`)
      }
    })

    ctx.command({
      name: 'skin',
      category: 'essentials',
      rank: 'Builder',
      usage: '/skin <name|url|reset> [player]',
      description: 'Changes your skin to another player\'s skin or an image URL',
      inGame: true,
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const target = args[1] ? find(player, args[1]) : player
        if (target !== player && player.permission < server.ranks.permissionOf('Operator')) throw new CommandError('Only operators can change other players\' skins.')
        const skin = args[0].toLowerCase() === 'reset' ? null : args[0]
        if (skin && skin.length > 64) throw new CommandError('Skin URLs can be at most 64 characters.')
        target.setSkin(skin)
        player.message(`&eSkin ${skin ? 'set to &f' + skin : 'reset'}&e.`)
      }
    })

    const setField = (field, label, validate) => (player, args, { usage }) => {
      if (!args[0]) return usage()
      const target = find(player, args[0])
      if (target !== player && target.permission >= player.permission && !player.isConsole) throw new CommandError(`You can't change the ${label} of ${target.name}.`)
      let value = args.slice(1).join(' ') || null
      if (value && validate) value = validate(value)
      target.record[field] = value
      server.playerDB.save()
      target.respawnForOthers()
      player.message(`&e${label[0].toUpperCase() + label.slice(1)} of ${target.name} ${value ? 'set to &f' + value : 'removed'}&e.`)
    }

    ctx.command({
      name: 'nick',
      aliases: ['nickname'],
      category: 'essentials',
      rank: 'AdvBuilder',
      usage: '/nick <player> [nickname]',
      description: 'Sets or removes a nickname',
      run: setField('nick', 'nickname', v => {
        v = text.stripColors(v)
        if (v.length > 30) throw new CommandError('Nicknames can be at most 30 characters.')
        return v
      })
    })

    ctx.command({
      name: 'color',
      aliases: ['colour'],
      category: 'essentials',
      rank: 'AdvBuilder',
      usage: '/color <player> [color]',
      description: 'Sets the name color of a player (e.g. red, &c, lime)',
      run: setField('color', 'color', v => {
        const c = text.parseColor(v)
        if (!c) throw new CommandError(`Unknown color. Use one of: ${Object.keys(text.COLORS).join(', ')}`)
        return c
      })
    })

    ctx.command({
      name: 'title',
      category: 'essentials',
      rank: 'Operator',
      usage: '/title <player> [title]',
      description: 'Sets a title shown before the name in chat',
      run: setField('title', 'title', v => {
        if (text.stripColors(v).length > 20) throw new CommandError('Titles can be at most 20 characters.')
        return text.convertPercentCodes(v)
      })
    })

    // CPE toys

    ctx.command({
      name: 'hold',
      aliases: ['holdblock'],
      category: 'essentials',
      usage: '/hold <block> [lock]',
      description: 'Puts a block in your hand',
      inGame: true,
      run (player, args, { usage }) {
        const block = player.level.parseBlock(args[0])
        if (block === null) return usage()
        if (!player.supports('HeldBlock')) throw new CommandError('Your client does not support this.')
        player.holdBlock(block, args[1] === 'lock')
        player.message(`&eYou are now holding &f${player.level.blockName(block)}&e.`)
      }
    })

    ctx.command({
      name: 'reach',
      aliases: ['clickdistance'],
      category: 'essentials',
      rank: 'Operator',
      usage: '/reach <blocks> [player]',
      description: 'Changes how far away you can place blocks (default 5)',
      inGame: true,
      run (player, args, { usage }) {
        const dist = Number(args[0])
        if (!(dist >= 1 && dist <= 1024)) return usage()
        const target = args[1] ? find(player, args[1]) : player
        if (!target.supports('ClickDistance')) throw new CommandError('That client does not support changing the reach.')
        target.setReach(dist)
        player.message(`&eReach of ${target.name} set to &f${dist}&e blocks.`)
      }
    })

    ctx.command({
      name: 'fly',
      aliases: ['hacks'],
      category: 'essentials',
      rank: 'Operator',
      usage: '/fly <on|off> [player]',
      description: 'Allows or forbids hacks (fly, noclip, speed) for a player',
      inGame: true,
      run (player, args, { usage }) {
        const mode = (args[0] || '').toLowerCase()
        if (!['on', 'off'].includes(mode)) return usage()
        const target = args[1] ? find(player, args[1]) : player
        if (!target.supports('HackControl')) throw new CommandError('That client does not support hack control.')
        const on = mode === 'on'
        target.setHacks({ flying: on, noClip: on, speeding: on, spawnControl: true, thirdPerson: true })
        player.message(`&eHacks ${on ? 'allowed' : 'disabled'} for ${target.name}.`)
      }
    })

    // AFK

    ctx.command({
      name: 'afk',
      category: 'essentials',
      usage: '/afk [reason]',
      description: 'Marks you as away from keyboard',
      inGame: true,
      run (player, args) {
        setAfk(player, !isAfk(player), args.join(' ') || null)
      }
    })

    ctx.on('playerChat', ({ player }) => setAfk(player, false), { priority: 'monitor' })
    ctx.on('playerMove', ({ player, from, to }) => {
      if (isAfk(player) && Math.hypot(to.x - from.x, to.z - from.z) > 8) setAfk(player, false)
    }, { priority: 'monitor' })
    ctx.on('playerCommand', ({ player, label }) => { if (label !== 'afk' && !player.isConsole) setAfk(player, false) }, { priority: 'monitor' })

    if (config.autoAfkMinutes > 0) {
      ctx.setInterval(() => {
        const limit = Date.now() - config.autoAfkMinutes * 60000
        for (const p of server.online) if (!isAfk(p) && p.lastActivity < limit) setAfk(p, true, 'auto')
      }, 15000)
    }

    require('./more')(ctx, { find })
    require('./social')(ctx)

    ctx.on('tabListEntry', (ev) => {
      if (isAfk(ev.player)) ev.listName += ' &7(AFK)'
      ev.groupRank = Math.max(0, 255 - Math.max(0, Math.min(255, ev.player.permission)))
    })
  }
}
