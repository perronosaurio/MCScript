'use strict'

// Extra moderation commands in the spirit of MCGalaxy:
// /warn /xban /temprank /report /whitelist /moveall /moderate /voice /opchat /adminchat /rankmsg
// /baninfo /banedit /follow /p2p /rankinfo /playeredit /limit /patrol

module.exports = function more (ctx, h) {
  const { server, config, text, CommandError } = ctx
  const { find, findRecord, rankOf, checkHigher, actorName } = h
  const ranks = server.ranks

  // warnings: the third one kicks

  ctx.command({
    name: 'warn',
    category: 'moderation',
    rank: 'Operator',
    usage: '/warn <player> [reason]',
    description: 'Warns a player. On the third warning they are kicked',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      const target = find(player, args[0])
      checkHigher(player, target.record)
      const reason = args.slice(1).join(' ') || 'no reason given'
      const warnings = (target.record.warnings || []).filter(w => Date.now() - w.at < 86400000)
      warnings.push({ by: actorName(player), reason, at: Date.now() })
      target.record.warnings = warnings
      server.playerDB.save()
      server.broadcast(`&e${target.coloredName}&e was warned by ${player.coloredName}&e: &f${reason} &7(${warnings.length}/3)`)
      target.message(`&cYou have been warned: ${reason}`, 'announce')
      if (warnings.length >= 3) {
        target.record.warnings = []
        target.kick(`Warned 3 times: ${reason}`)
      }
    }
  })

  ctx.command({
    name: 'xban',
    category: 'moderation',
    rank: 'Admin',
    usage: '/xban <player> [reason]',
    description: 'Bans a player and their IP, and undoes their changes of the last day',
    async run (player, args, { usage }) {
      if (!args[0]) return usage()
      const record = findRecord(args[0])
      checkHigher(player, record)
      const reason = args.slice(1).join(' ')
      const level = player.isConsole ? '' : ` ${player.level.name}`
      if (!player.isConsole) await server.commands.execute(player, `/undoplayer ${record.name} 1d${level}`)
      if (record.lastIp) await server.commands.execute(player, `/banip ${record.lastIp} ${reason}`)
      await server.commands.execute(player, `/ban ${record.name} ${reason}`)
    }
  })

  // temporary ranks

  const checkTempRanks = () => {
    for (const record of server.online.map(p => p.record)) {
      const t = record.tempRank
      if (t && t.until < Date.now()) {
        record.tempRank = null
        server.setRank(record.name, ranks.get(t.previous) || ranks.default, 'temprank expired')
        const p = server.findPlayerExact(record.name)
        if (p) p.message(`&eYour temporary rank expired, you are ${p.rank.color}${p.rank.name}&e again.`)
      }
    }
  }
  ctx.setInterval(checkTempRanks, 30000)
  ctx.on('playerJoin', () => checkTempRanks())

  ctx.command({
    name: 'temprank',
    aliases: ['tr', 'tempr'],
    category: 'moderation',
    rank: 'Admin',
    usage: '/temprank <player> <rank> <duration e.g. 2h>',
    description: 'Gives a rank for a limited time',
    run (player, args, { usage }) {
      if (args.length < 3) return usage()
      const record = findRecord(args[0])
      const rank = ranks.get(args[1])
      const ms = text.parseDuration(args[2])
      if (!rank || !ms) return usage()
      checkHigher(player, record)
      if (!player.isConsole && rank.permission >= player.permission) throw new CommandError('You can only give ranks lower than your own.')
      const previous = record.tempRank ? record.tempRank.previous : rankOf(record).name
      server.setRank(record.name, rank, actorName(player))
      record.tempRank = { previous, until: Date.now() + ms, by: actorName(player) }
      server.playerDB.save()
      server.broadcast(`&e${record.name} is ${rank.color}${rank.name}&e for ${text.formatDuration(ms)}.`)
    }
  })

  // reports

  const reports = ctx.loadData('reports.json', [])
  ctx.command({
    name: 'report',
    category: 'moderation',
    usage: '/report <player> <reason> | /report list | /report clear',
    description: 'Reports a player to the staff',
    run (player, args, { usage }) {
      const sub = (args[0] || '').toLowerCase()
      const staff = player.isConsole || player.permission >= ranks.permissionOf('Operator')
      if (sub === 'list' && staff) {
        if (!reports.length) return player.message('&eNo reports.')
        reports.slice(-15).forEach(r => player.message(`&f${r.target}&7 by ${r.by} (${text.formatDuration(Date.now() - r.at)} ago): ${r.reason}`))
        return
      }
      if (sub === 'clear' && staff) {
        reports.length = 0
        ctx.saveData('reports.json', reports)
        return player.message('&eReports cleared.')
      }
      if (args.length < 2) return usage()
      const record = findRecord(args[0])
      const reason = text.sanitize(args.slice(1).join(' '))
      reports.push({ target: record.name, by: actorName(player), reason, at: Date.now() })
      while (reports.length > 200) reports.shift()
      ctx.saveData('reports.json', reports)
      player.message('&eThanks, the staff will look into it.')
      server.broadcast(`&c[Report] &f${actorName(player)} reported ${record.name}: ${reason}`, p => p.permission >= ranks.permissionOf('Operator'))
    }
  })

  // whitelist

  ctx.on('playerConnecting', (ev) => {
    const wl = config.whitelist
    if (!wl || !wl.enabled) return
    const record = server.playerDB.get(ev.name)
    const staff = record && rankOf(record).permission >= ranks.permissionOf('Operator')
    if (!staff && !wl.players.includes(ev.name.toLowerCase())) ev.cancel('You are not on the whitelist')
  }, { priority: 'critical' })

  ctx.command({
    name: 'whitelist',
    aliases: ['wl'],
    category: 'moderation',
    rank: 'Admin',
    usage: '/whitelist <on|off|add|remove|list> [player]',
    description: 'Only lets listed players (and staff) join',
    run (player, args, { usage }) {
      const wl = config.whitelist || (config.whitelist = { enabled: false, players: [] })
      const sub = (args[0] || '').toLowerCase()
      const name = (args[1] || '').toLowerCase()
      if (sub === 'list') return player.message(`&eWhitelist (${wl.enabled ? 'on' : 'off'}): &f${wl.players.join(', ') || 'empty'}`)
      if (sub === 'on' || sub === 'off') {
        wl.enabled = sub === 'on'
      } else if (sub === 'add' && name) {
        if (!wl.players.includes(name)) wl.players.push(name)
      } else if (sub === 'remove' && name) {
        wl.players = wl.players.filter(n => n !== name)
      } else {
        return usage()
      }
      ctx.saveConfig()
      player.message(`&eWhitelist ${wl.enabled ? 'on' : 'off'}, ${wl.players.length} player(s).`)
    }
  })

  ctx.command({
    name: 'moveall',
    category: 'moderation',
    rank: 'Admin',
    usage: '/moveall <level>',
    description: 'Moves every player to a level',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      const name = server.levels.resolveName(args[0])
      if (!name) throw new CommandError('Unknown level.')
      const level = server.levels.load(name)
      for (const p of server.online) if (p.level !== level) p.changeLevel(level, { force: true })
      player.message(`&eEveryone was moved to ${level.name}.`)
    }
  })

  // moderated chat: only voiced players and staff can talk

  let moderated = false
  ctx.on('playerChat', (ev) => {
    if (!moderated) return
    const p = ev.player
    if (p.data.voice || p.permission >= ranks.permissionOf('Operator')) return
    ev.cancel('&cChat is moderated right now. Ask the staff for a voice.')
  }, { priority: 'critical' })

  ctx.command({
    name: 'moderate',
    category: 'moderation',
    rank: 'Operator',
    usage: '/moderate',
    description: 'Toggles moderated chat (only staff and /voice players can talk)',
    run () {
      moderated = !moderated
      server.broadcast(moderated ? '&cChat is now moderated.' : '&aChat is no longer moderated.')
    }
  })

  ctx.command({
    name: 'voice',
    category: 'moderation',
    rank: 'Operator',
    usage: '/voice <player>',
    description: 'Lets a player talk while chat is moderated (toggle)',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      const target = find(player, args[0])
      target.data.voice = !target.data.voice
      server.broadcast(`&e${target.coloredName}&e ${target.data.voice ? 'got a voice' : 'lost their voice'}.`)
    }
  })

  // staff chats: "#message" for operators, "+message" for admins

  const staffChat = (minRank, label, color) => (sender, message) => {
    const perm = ranks.permissionOf(minRank)
    server.broadcast(`${color}[${label}] ${sender.coloredName || sender.name}${color}: &f${text.sanitize(message)}`, p => p.permission >= perm)
    if (sender.isConsole !== true && sender.permission < perm) sender.message(`${color}[${label}] (sent)`)
  }
  const opChat = staffChat('Operator', 'Op', '&c')
  const adminChat = staffChat('Admin', 'Admin', '&e')

  ctx.on('playerChat', (ev) => {
    const m = ev.message
    if (m.length < 2) return
    if (m[0] === '#' && ev.player.permission >= ranks.permissionOf('Operator')) { ev.cancel(); opChat(ev.player, m.slice(1)) }
    if (m[0] === '+' && ev.player.permission >= ranks.permissionOf('Admin')) { ev.cancel(); adminChat(ev.player, m.slice(1)) }
  }, { priority: 'critical' })

  ctx.command({ name: 'opchat', aliases: ['oc'], category: 'chat', usage: '/opchat <message>', description: 'Sends a message only operators can read (or start a message with #)', run (p, args, { usage, raw }) { if (!raw) return usage(); opChat(p, raw) } })
  ctx.command({ name: 'adminchat', aliases: ['ac'], category: 'chat', usage: '/adminchat <message>', description: 'Sends a message only admins can read (or start a message with +)', run (p, args, { usage, raw }) { if (!raw) return usage(); adminChat(p, raw) } })

  ctx.command({
    name: 'rankmsg',
    aliases: ['rm'],
    category: 'chat',
    rank: 'Operator',
    usage: '/rankmsg <rank> <message>',
    description: 'Sends a message to everyone with a rank (and higher)',
    run (player, args, { usage }) {
      const rank = ranks.get(args[0])
      if (!rank || args.length < 2) return usage()
      server.broadcast(`${rank.color}[${rank.name}+] ${player.coloredName}&f: ${text.sanitize(args.slice(1).join(' '))}`, p => p.permission >= rank.permission || p === player)
    }
  })

  // ban details

  ctx.command({
    name: 'baninfo',
    category: 'moderation',
    rank: 'Operator',
    usage: '/baninfo <player>',
    description: 'Shows why and until when a player is banned',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      const record = findRecord(args[0])
      const ban = record.ban
      if (!ban) return player.message(`&e${record.name} is not banned.`)
      player.message(`&e${record.name} was banned by &f${ban.by}&e ${text.formatDuration(Date.now() - ban.at)} ago.`)
      player.message(`&7Reason: &f${ban.reason || 'none'}&7, ${ban.until ? 'ends in ' + text.formatDuration(ban.until - Date.now()) : 'permanent'}`)
    }
  })

  ctx.command({
    name: 'banedit',
    category: 'moderation',
    rank: 'Operator',
    usage: '/banedit <player> <reason>',
    description: 'Changes the reason of a ban',
    run (player, args, { usage }) {
      if (args.length < 2) return usage()
      const record = findRecord(args[0])
      if (!record.ban) throw new CommandError(`${record.name} is not banned.`)
      record.ban.reason = args.slice(1).join(' ')
      server.playerDB.save()
      player.message('&eBan reason updated.')
    }
  })

  // watching players

  const followers = new Map() // follower -> target
  ctx.setInterval(() => {
    for (const [follower, target] of followers) {
      if (follower.conn.closed || target.conn.closed) { followers.delete(follower); continue }
      if (follower.level !== target.level) { follower.changeLevel(target.level, { force: true, silent: true }); continue }
      const d = Math.hypot(follower.pos.x - target.pos.x, follower.pos.z - target.pos.z) / 32
      if (d > 4) follower.teleportTo(target)
    }
  }, 500)

  ctx.command({
    name: 'follow',
    category: 'moderation',
    rank: 'Operator',
    usage: '/follow [player]',
    description: 'Keeps you close to a player (run it again to stop)',
    inGame: true,
    run (player, args) {
      if (!args[0] || followers.get(player)) {
        followers.delete(player)
        return player.message('&eYou stopped following.')
      }
      const target = find(player, args[0])
      if (target === player) throw new CommandError('You can\'t follow yourself.')
      followers.set(player, target)
      player.message(`&eFollowing ${target.name}. Type &f/follow&e to stop.`)
    }
  })

  ctx.command({
    name: 'p2p',
    category: 'moderation',
    rank: 'Operator',
    usage: '/p2p <player> <target>',
    description: 'Teleports a player to another player',
    run (player, args, { usage }) {
      if (args.length < 2) return usage()
      const a = find(player, args[0])
      const b = find(player, args[1])
      if (a !== player) checkHigher(player, a.record)
      if (a.teleportTo(b)) player.message(`&e${a.name} was teleported to ${b.name}.`)
    }
  })

  ctx.command({
    name: 'patrol',
    category: 'moderation',
    rank: 'Operator',
    usage: '/patrol',
    description: 'Teleports you to a lower ranked player you have not visited recently',
    inGame: true,
    run (player) {
      const visited = player.data.patrolled || (player.data.patrolled = new Map())
      const candidates = server.online.filter(p => p !== player && p.permission < player.permission && Date.now() - (visited.get(p.name) || 0) > 60000)
      if (!candidates.length) throw new CommandError('Nobody to patrol right now.')
      const target = candidates[Math.floor(Math.random() * candidates.length)]
      visited.set(target.name, Date.now())
      player.teleportTo(target)
      player.message(`&ePatrolling ${target.name}.`)
    }
  })

  ctx.command({
    name: 'rankinfo',
    aliases: ['ri'],
    category: 'moderation',
    usage: '/rankinfo <player>',
    description: 'Shows the rank changes of a player',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      const record = findRecord(args[0])
      const history = record.rankHistory || []
      if (!history.length) return player.message(`&e${record.name} has always been ${rankOf(record).name}.`)
      for (const h of history.slice(-10)) {
        player.message(`&7${new Date(h.at).toISOString().slice(0, 10)}: &f${h.from} &7-> &f${h.to}${h.by ? ' &7by ' + h.by : ''}`)
      }
    }
  })

  // editing data

  const EDITABLE = { logins: 'number', timeSpent: 'number', blocksPlaced: 'number', blocksDeleted: 'number', messages: 'number', kicks: 'number', nick: 'text', title: 'text', model: 'text', skin: 'text' }
  ctx.command({
    name: 'playeredit',
    aliases: ['pe'],
    category: 'moderation',
    rank: 'Admin',
    usage: '/playeredit <player> <field> [value]',
    description: `Edits saved player data. Fields: ${Object.keys(EDITABLE).join(', ')}`,
    run (player, args, { usage }) {
      if (args.length < 2) return usage()
      const record = findRecord(args[0])
      const field = Object.keys(EDITABLE).find(f => f.toLowerCase() === args[1].toLowerCase())
      if (!field) throw new CommandError(`Fields: ${Object.keys(EDITABLE).join(', ')}`)
      const raw = args.slice(2).join(' ')
      let value = raw || null
      if (EDITABLE[field] === 'number') {
        value = Number(raw)
        if (!Number.isFinite(value) || value < 0) throw new CommandError('That field needs a number.')
      }
      record[field] = value
      server.playerDB.save()
      player.message(`&e${record.name}'s ${field} is now &f${value ?? 'empty'}`)
    }
  })

  ctx.command({
    name: 'limit',
    category: 'moderation',
    rank: 'Owner',
    usage: '/limit <rank> <draw|undo> <amount>',
    description: 'Changes how many blocks a rank can draw or undo at once',
    run (player, args, { usage }) {
      const rank = ranks.get(args[0])
      const kind = (args[1] || '').toLowerCase()
      const amount = Number(args[2])
      if (!rank || !['draw', 'undo'].includes(kind) || !Number.isInteger(amount) || amount < 0) return usage()
      rank[kind === 'draw' ? 'drawLimit' : 'maxUndo'] = amount
      ranks.save()
      player.message(`&e${rank.color}${rank.name}&e can now ${kind} ${amount.toLocaleString()} blocks.`)
    }
  })
}
