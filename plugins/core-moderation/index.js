'use strict'

// Ranks, kicks, bans (temporary and IP), mutes, freeze, vanish and anti-spam.

module.exports = {
  name: 'core-moderation',
  version: '2.0.0',
  description: 'Moderation tools and anti-spam',
  author: 'MCScript',

  defaultConfig: {
    antiSpam: {
      enabled: true,
      maxMessages: 6,
      perSeconds: 5,
      muteSeconds: 15,
      maxBlocks: 250,
      blocksPerSeconds: 5,
      exemptRank: 'Operator'
    }
  },

  load (ctx) {
    const { server, config, text, CommandError } = ctx
    const ranks = server.ranks
    const ipBans = ctx.loadData('ipbans.json', {})
    const saveIpBans = () => ctx.saveData('ipbans.json', ipBans)

    const actorName = p => p.isConsole ? 'Console' : p.name
    const find = (player, name) => {
      if (!name) throw new CommandError('You need to specify a player.')
      const target = server.findPlayer(name, player)
      if (!target) throw new CommandError('Player not found.')
      return target
    }
    // player record for online or offline players
    const findRecord = (name) => {
      const online = server.matchPlayers(name)
      if (online.length === 1) return online[0].record
      const r = server.playerDB.find(name)
      if (!r) throw new CommandError(`No player named "${name}" has joined this server.`)
      return r
    }
    const rankOf = record => ranks.get(record.rank) || ranks.default
    const checkHigher = (player, record) => {
      if (player.isConsole) return
      if (record.name.toLowerCase() === player.name.toLowerCase()) throw new CommandError('You can\'t do that to yourself.')
      if (rankOf(record).permission >= player.permission) throw new CommandError(`You can't do that to ${record.name}, their rank is not lower than yours.`)
    }
    // Optional duration as first argument: "/ban name 2h reason"
    const takeDuration = (args) => {
      const ms = text.parseDuration(args[0])
      if (ms !== null && ms > 0) { args.shift(); return ms }
      return null
    }

    // ---------------------------------------------------------------- ranks

    ctx.command({
      name: 'rank',
      aliases: ['setrank', 'pass'],
      category: 'moderation',
      rank: 'Operator',
      usage: '/rank <player> <rank>',
      description: 'Changes the rank of a player',
      run (player, args, { usage }) {
        if (args.length < 2) return usage()
        const record = findRecord(args[0])
        const rank = ranks.get(args[1])
        if (!rank) throw new CommandError(`Unknown rank. Ranks: ${ranks.all.map(r => r.name).join(', ')}`)
        checkHigher(player, record)
        if (!player.isConsole && rank.permission >= player.permission) throw new CommandError('You can only give ranks lower than your own.')
        server.setRank(record.name, rank, actorName(player))
        server.broadcast(`&e${record.name} is now ${rank.color}${rank.name}&e.`)
      }
    })

    const step = (dir) => (player, args, { usage }) => {
      if (!args[0]) return usage()
      const record = findRecord(args[0])
      checkHigher(player, record)
      const all = ranks.all.filter(r => r.permission >= 0)
      const i = all.indexOf(rankOf(record))
      const rank = all[i + dir]
      if (!rank) throw new CommandError(`${record.name} can't be ${dir > 0 ? 'promoted' : 'demoted'} any further.`)
      if (!player.isConsole && rank.permission >= player.permission) throw new CommandError('You can only give ranks lower than your own.')
      server.setRank(record.name, rank, actorName(player))
      server.broadcast(`&e${record.name} was ${dir > 0 ? 'promoted' : 'demoted'} to ${rank.color}${rank.name}&e.`)
    }

    ctx.command({ name: 'promote', category: 'moderation', rank: 'Operator', usage: '/promote <player>', description: 'Moves a player up one rank', run: step(1) })
    ctx.command({ name: 'demote', category: 'moderation', rank: 'Operator', usage: '/demote <player>', description: 'Moves a player down one rank', run: step(-1) })

    ctx.command({
      name: 'ranks',
      aliases: ['viewranks'],
      category: 'moderation',
      usage: '/ranks [rank]',
      description: 'Lists the ranks, or the players in a rank',
      run (player, args) {
        if (!args[0]) {
          player.message('&eRanks: ' + ranks.all.map(r => `${r.color}${r.name}&7 (${r.permission})`).join('&7, '))
          return
        }
        const rank = ranks.get(args[0])
        if (!rank) throw new CommandError('Unknown rank.')
        const members = server.playerDB.all().filter(r => rankOf(r) === rank).map(r => r.name)
        player.message(`${rank.color}${rank.name}&e (${members.length}): &f${members.slice(0, 60).join(', ') || 'nobody'}`)
      }
    })

    // ---------------------------------------------------------------- kick / ban

    ctx.command({
      name: 'kick',
      aliases: ['k'],
      category: 'moderation',
      rank: 'Operator',
      usage: '/kick <player> [reason]',
      description: 'Disconnects a player',
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const target = find(player, args[0])
        checkHigher(player, target.record)
        const reason = args.slice(1).join(' ') || 'You were kicked'
        target.record.kicks++
        server.broadcast(`&e${target.coloredName}&e was kicked by ${player.coloredName}&e: &f${reason}`)
        target.kick(`Kicked by ${actorName(player)}: ${reason}`)
      }
    })

    ctx.command({
      name: 'ban',
      aliases: ['tempban', 'tb'],
      category: 'moderation',
      rank: 'Operator',
      usage: '/ban <player> [duration e.g. 30m, 2h, 7d] [reason]',
      description: 'Bans a player, optionally for a limited time',
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const record = findRecord(args.shift())
        checkHigher(player, record)
        const duration = takeDuration(args)
        const reason = args.join(' ') || null
        record.ban = { by: actorName(player), reason, at: Date.now(), until: duration ? Date.now() + duration : null }
        server.playerDB.save()
        const time = duration ? ` for ${text.formatDuration(duration)}` : ''
        server.broadcast(`&c${record.name} was banned${time} by ${actorName(player)}${reason ? ': &f' + reason : ''}`)
        const online = server.findPlayerExact(record.name)
        if (online) online.kick(`Banned${time}${reason ? ': ' + reason : ''}`)
      }
    })

    ctx.command({
      name: 'unban',
      category: 'moderation',
      rank: 'Operator',
      usage: '/unban <player>',
      description: 'Removes a ban',
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const record = server.playerDB.find(args[0])
        if (!record || !record.ban) throw new CommandError(`${args[0]} is not banned.`)
        record.ban = null
        if (rankOf(record).permission < 0) record.rank = ranks.default.name
        server.playerDB.save()
        server.broadcast(`&a${record.name} was unbanned by ${actorName(player)}.`)
      }
    })

    ctx.command({
      name: 'banip',
      aliases: ['ipban'],
      category: 'moderation',
      rank: 'Admin',
      usage: '/banip <player|ip> [reason]',
      description: 'Bans an IP address',
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        let ip = args[0]
        if (!/^[0-9a-f.:]+$/i.test(ip)) {
          const record = findRecord(ip)
          checkHigher(player, record)
          ip = record.lastIp
        }
        if (!ip) throw new CommandError('Unknown IP.')
        if (!player.isConsole && ip === player.ip) throw new CommandError('You can\'t ban your own IP.')
        ipBans[ip] = { by: actorName(player), reason: args.slice(1).join(' ') || null, at: Date.now() }
        saveIpBans()
        for (const p of server.online) if (p.ip === ip) p.kick('Your IP has been banned')
        player.message(`&aBanned IP ${ip}.`)
      }
    })

    ctx.command({
      name: 'unbanip',
      category: 'moderation',
      rank: 'Admin',
      usage: '/unbanip <ip>',
      description: 'Removes an IP ban',
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        if (!ipBans[args[0]]) throw new CommandError('That IP is not banned.')
        delete ipBans[args[0]]
        saveIpBans()
        player.message(`&aUnbanned IP ${args[0]}.`)
      }
    })

    ctx.command({
      name: 'bans',
      aliases: ['banlist'],
      category: 'moderation',
      rank: 'Operator',
      usage: '/bans',
      description: 'Lists banned players and IPs',
      run (player) {
        const banned = server.playerDB.all().filter(r => r.ban)
        player.message(`&eBanned players (${banned.length}): &f${banned.map(r => r.name + (r.ban.until ? '&7(temp)&f' : '')).join(', ') || 'none'}`)
        const ips = Object.keys(ipBans)
        player.message(`&eBanned IPs (${ips.length}): &f${ips.join(', ') || 'none'}`)
      }
    })

    // Enforce bans when someone connects
    ctx.on('playerConnecting', (ev) => {
      const ipBan = ipBans[ev.ip]
      if (ipBan) return ev.cancel(`Your IP is banned${ipBan.reason ? ': ' + ipBan.reason : ''}`)
      const record = server.playerDB.get(ev.name)
      if (!record || !record.ban) return
      if (record.ban.until && record.ban.until < Date.now()) {
        record.ban = null
        server.playerDB.save()
        return
      }
      const left = record.ban.until ? ` (${text.formatDuration(record.ban.until - Date.now())} left)` : ''
      ev.cancel(`Banned${left}${record.ban.reason ? ': ' + record.ban.reason : ''}`)
    }, { priority: 'critical' })

    // ---------------------------------------------------------------- mute / freeze / vanish

    ctx.command({
      name: 'mute',
      category: 'moderation',
      rank: 'Operator',
      usage: '/mute <player> [duration] [reason]',
      description: 'Prevents a player from chatting (default 1 hour)',
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const target = find(player, args.shift())
        checkHigher(player, target.record)
        const duration = takeDuration(args) || 3600000
        target.record.muteUntil = Date.now() + duration
        target.record.muteReason = args.join(' ') || null
        server.playerDB.save()
        server.broadcast(`&e${target.coloredName}&e was muted for ${text.formatDuration(duration)}.`)
      }
    })

    ctx.command({
      name: 'unmute',
      category: 'moderation',
      rank: 'Operator',
      usage: '/unmute <player>',
      description: 'Allows a muted player to chat again',
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const record = findRecord(args[0])
        record.muteUntil = null
        server.playerDB.save()
        server.broadcast(`&e${record.name} was unmuted.`)
      }
    })

    ctx.command({
      name: 'freeze',
      aliases: ['fz'],
      category: 'moderation',
      rank: 'Operator',
      usage: '/freeze <player>',
      description: 'Stops a player from moving (toggle)',
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const target = find(player, args[0])
        checkHigher(player, target.record)
        target.frozen = !target.frozen
        server.broadcast(`&e${target.coloredName}&e was ${target.frozen ? 'frozen' : 'unfrozen'} by ${player.coloredName}&e.`)
      }
    })

    ctx.command({
      name: 'vanish',
      aliases: ['hide', 'v'],
      category: 'moderation',
      rank: 'Operator',
      usage: '/vanish',
      description: 'Makes you invisible to lower ranks (toggle)',
      inGame: true,
      run (player) {
        player.hidden = !player.hidden
        for (const other of server.players) {
          if (other === player || !other.spawned) continue
          if (other.level === player.level) {
            if (player.hidden) other.hideEntity(player.id)
            else other.showEntity(player.entityInfo())
          }
          if (player.hidden && other.permission < player.permission && other.supports('ExtPlayerList')) {
            other.conn.write('extRemovePlayerName', { nameId: player.id })
          }
        }
        if (!player.hidden) server.tabList.update(player)
        player.message(player.hidden ? '&eYou are now hidden.' : '&eYou are visible again.')
        if (player.hidden) server.broadcast(`&c- ${player.coloredName} &eleft the game`, p => p.permission < player.permission)
        else server.broadcast(`&a+ ${player.coloredName} &ejoined the game`, p => p.permission < player.permission)
      }
    })

    // ---------------------------------------------------------------- anti-spam

    const spam = config.antiSpam
    if (spam && spam.enabled) {
      const exempt = p => p.permission >= ranks.permissionOf(spam.exemptRank)
      const track = (p, key, max, seconds) => {
        const now = Date.now()
        const list = (p.data[key] = (p.data[key] || []).filter(t => t > now - seconds * 1000))
        list.push(now)
        return list.length > max
      }

      ctx.on('playerChat', (ev) => {
        const p = ev.player
        if (exempt(p)) return
        if (track(p, 'mod.chat', spam.maxMessages, spam.perSeconds)) {
          p.record.muteUntil = Date.now() + spam.muteSeconds * 1000
          p.data['mod.chat'] = []
          ev.cancel(`&cYou have been muted for ${spam.muteSeconds} seconds for spamming.`)
          server.broadcast(`&e${p.coloredName}&e was auto-muted for spamming.`, other => other !== p)
        }
      }, { priority: 'high' })

      ctx.on('blockChange', (ev) => {
        const p = ev.player
        if (exempt(p)) return
        if (track(p, 'mod.blocks', spam.maxBlocks, spam.blocksPerSeconds)) {
          ev.cancel()
          server.broadcast(`&c${p.name} was kicked for building too fast (possible griefing tool).`)
          p.kick('Building too fast')
        }
      }, { priority: 'high' })
    }
  }
}
