'use strict'

// More everyday commands, mostly the ones MCGalaxy players expect:
// /back /ascend /descend /tpa /kill /clear /roll /8ball /hug /faq /news /oprules /view /top /search
// /blocks /pclients /whonick /tcolor /send /inbox /loginmessage /logoutmessage /lastcmd and chat emotes.

const fs = require('fs')
const path = require('path')

// (name) -> CP437 character, like MCGalaxy's emotes
const EMOTES = {
  smile: '☺',
  darksmile: '☻',
  heart: '♥',
  diamond: '♦',
  club: '♣',
  spade: '♠',
  bullet: '•',
  note: '♪',
  notes: '♫',
  sun: '☼',
  male: '♂',
  female: '♀',
  right: '→',
  left: '←',
  up: '↑',
  down: '↓',
  updown: '↕',
  leftright: '↔',
  arrowup: '▲',
  arrowdown: '▼',
  arrowright: '►',
  arrowleft: '◄',
  house: '⌂',
  block: '█',
  half: '½',
  quarter: '¼',
  degree: '°',
  infinity: '∞',
  pi: 'π',
  sigma: 'Σ',
  alpha: 'α',
  beta: 'ß',
  mu: 'µ'
}

const TEXT_FILES = {
  faq: ['&eFrequently asked questions:', '&fHow do I build? &7Place and break blocks. Ask an operator if you are not allowed to build.', '&fHow do I get a higher rank? &7Build something nice and ask an operator.'],
  news: ['&eNo news yet. Edit config/text/news.txt to add some.'],
  oprules: ['&eRules for operators:', '&f1. &7Be fair and explain why you punish someone.', '&f2. &7Do not abuse commands on other players.']
}

const EIGHT_BALL = [
  'It is certain.', 'Without a doubt.', 'Yes, definitely.', 'Most likely.', 'Signs point to yes.', 'Ask again later.',
  'Better not tell you now.', 'Cannot predict now.', 'Don\'t count on it.', 'My reply is no.', 'Very doubtful.', 'Outlook not so good.'
]

module.exports = function more (ctx, { find }) {
  const { server, text, CommandError } = ctx
  const isOp = p => p.isConsole || p.permission >= server.ranks.permissionOf('Operator')

  // chat emotes: "(heart)" -> ♥
  ctx.on('playerChat', (ev) => {
    if (ev.player.data.noEmotes) return
    ev.message = ev.message.replace(/\(([a-z]+)\)/gi, (m, name) => EMOTES[name.toLowerCase()] || m)
  }, { priority: 'low' })

  ctx.command({
    name: 'emotes',
    aliases: ['emote'],
    category: 'chat',
    usage: '/emotes [list]',
    description: 'Toggles replacing (heart), (smile)... in your messages with symbols',
    run (player, args) {
      if ((args[0] || '').toLowerCase() === 'list') {
        return player.message('&eEmotes: &f' + Object.entries(EMOTES).map(([k, v]) => `(${k}) ${v}`).join('&7, &f'))
      }
      player.data.noEmotes = !player.data.noEmotes
      player.message(`&eEmotes are now ${player.data.noEmotes ? 'off' : 'on'}.`)
    }
  })

  // teleport helpers

  ctx.command({
    name: 'back',
    category: 'essentials',
    rank: 'Builder',
    usage: '/back',
    description: 'Takes you back to where you were before your last teleport',
    inGame: true,
    run (player) {
      const prev = player.previousPosition
      if (!prev) throw new CommandError('You have not teleported anywhere yet.')
      let level = server.levels.get(prev.level)
      if (!level) {
        if (!server.levels.exists(prev.level)) throw new CommandError('That level no longer exists.')
        level = server.levels.load(prev.level)
      }
      if (level !== player.level && !player.changeLevel(level)) return
      player.teleport(prev.x, prev.y, prev.z, prev.yaw, prev.pitch)
    }
  })

  const freeSpot = (level, x, y, z) => level.getBlock(x, y, z) === 0 && level.getBlock(x, y + 1, z) === 0 && level.getBlock(x, y - 1, z) !== 0
  const vertical = (dir) => (player) => {
    const { x, y, z } = player.blockPos
    const level = player.level
    for (let ny = y + dir; ny > 0 && ny < level.height - 1; ny += dir) {
      if (freeSpot(level, x, ny, z)) return player.teleport(x + 0.5, ny, z + 0.5)
    }
    throw new CommandError(`No free spot ${dir > 0 ? 'above' : 'below'} you.`)
  }

  ctx.command({ name: 'ascend', category: 'essentials', rank: 'Builder', usage: '/ascend', description: 'Moves you to the next free floor above', inGame: true, run: vertical(1) })
  ctx.command({ name: 'descend', category: 'essentials', rank: 'Builder', usage: '/descend', description: 'Moves you to the next free floor below', inGame: true, run: vertical(-1) })

  const requests = new Map() // target name -> { from, at }
  ctx.command({
    name: 'tpa',
    aliases: ['tprequest'],
    category: 'essentials',
    usage: '/tpa <player> | /tpa accept | /tpa deny',
    description: 'Asks a player if you can teleport to them',
    inGame: true,
    run (player, args, { usage }) {
      const sub = (args[0] || '').toLowerCase()
      if (!sub) return usage()
      if (sub === 'accept' || sub === 'deny') {
        const req = requests.get(player.name.toLowerCase())
        requests.delete(player.name.toLowerCase())
        const from = req && Date.now() - req.at < 120000 && server.findPlayerExact(req.from)
        if (!from) throw new CommandError('You have no pending teleport requests.')
        if (sub === 'deny') { from.message(`&c${player.name} denied your teleport request.`); return player.message('&eRequest denied.') }
        from.teleportTo(player)
        return player.message(`&e${from.name} teleported to you.`)
      }
      const target = find(player, args[0])
      if (target === player) throw new CommandError('You can\'t send a request to yourself.')
      requests.set(target.name.toLowerCase(), { from: player.name, at: Date.now() })
      target.message(`&e${player.coloredName}&e wants to teleport to you. Type &f/tpa accept&e or &f/tpa deny`)
      player.message(`&eRequest sent to ${target.name}.`)
    }
  })

  ctx.command({
    name: 'kill',
    aliases: ['respawn'],
    category: 'essentials',
    usage: '/kill [player] [message]',
    description: 'Sends you (or someone else) back to the level spawn',
    run (player, args) {
      const target = args[0] ? find(player, args[0]) : player
      if (target.isConsole) throw new CommandError('Specify a player.')
      if (target !== player && !isOp(player)) throw new CommandError('Only operators can kill other players.')
      const s = target.level.spawn
      target.teleport(s.x, s.y, s.z, s.yaw, s.pitch)
      const msg = args.slice(1).join(' ')
      server.broadcast(`&c${target.coloredName}&c ${msg || (target === player ? 'killed themselves' : 'was killed by ' + player.name)}.`, p => p.level === target.level)
    }
  })

  // chat fun

  ctx.command({
    name: 'clear',
    aliases: ['clearchat', 'cls'],
    category: 'chat',
    usage: '/clear [all]',
    description: 'Clears your chat (operators can clear everyone\'s)',
    run (player, args) {
      const targets = (args[0] || '').toLowerCase() === 'all' && isOp(player) ? server.online : [player]
      for (const t of targets) for (let i = 0; i < 20; i++) t.message(' ')
    }
  })

  ctx.command({
    name: 'roll',
    aliases: ['dice'],
    category: 'chat',
    usage: '/roll [min] [max]',
    description: 'Rolls a random number (1 to 6 by default)',
    run (player, args) {
      let min = args.length > 1 ? Number(args[0]) : 1
      let max = args.length > 1 ? Number(args[1]) : args.length ? Number(args[0]) : 6
      if (!Number.isInteger(min) || !Number.isInteger(max)) throw new CommandError('Use whole numbers.')
      if (min > max) [min, max] = [max, min]
      const n = min + Math.floor(Math.random() * (max - min + 1))
      server.broadcast(`&e${player.coloredName}&e rolled &f${n}&e (${min}-${max})`)
    }
  })

  ctx.command({
    name: '8ball',
    category: 'chat',
    usage: '/8ball <question>',
    description: 'Asks the magic 8 ball',
    run (player, args, { usage, raw }) {
      if (!args.length) return usage()
      const answer = EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)]
      server.broadcast(`&e${player.coloredName}&e asked the 8 ball: &f${text.sanitize(raw)}`)
      server.broadcast(`&5The 8 ball says: &f${answer}`)
    }
  })

  const social = (verb, past) => (player, args, { usage }) => {
    if (!args[0]) return usage()
    const target = find(player, args[0])
    server.broadcast(`&d* ${player.coloredName}&d ${past} ${target.coloredName}&d${args[1] ? ' ' + text.sanitize(args.slice(1).join(' ')) : ''}.`)
  }
  ctx.command({ name: 'hug', category: 'chat', usage: '/hug <player>', description: 'Hugs someone', run: social('hug', 'hugged') })
  ctx.command({ name: 'high5', aliases: ['highfive'], category: 'chat', usage: '/high5 <player>', description: 'High fives someone', run: social('high five', 'high fived') })

  // text files: config/text/<name>.txt

  const textDir = path.join(server.root, 'config', 'text')
  const readText = (name) => {
    const file = path.join(textDir, `${name}.txt`)
    if (!fs.existsSync(file)) {
      if (!TEXT_FILES[name]) return null
      fs.mkdirSync(textDir, { recursive: true })
      fs.writeFileSync(file, TEXT_FILES[name].join('\n') + '\n')
    }
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim())
  }
  const showText = (name) => (player) => {
    for (const line of readText(name) || []) player.message(text.convertPercentCodes(line))
  }
  ctx.command({ name: 'faq', category: 'essentials', usage: '/faq', description: 'Frequently asked questions (config/text/faq.txt)', run: showText('faq') })
  ctx.command({ name: 'news', category: 'essentials', usage: '/news', description: 'Server news (config/text/news.txt)', run: showText('news') })
  ctx.command({ name: 'oprules', category: 'moderation', rank: 'Operator', usage: '/oprules', description: 'Rules for operators (config/text/oprules.txt)', run: showText('oprules') })
  ctx.command({
    name: 'view',
    category: 'essentials',
    usage: '/view [file]',
    description: 'Shows a text file from config/text',
    run (player, args) {
      if (!args[0]) {
        const files = fs.existsSync(textDir) ? fs.readdirSync(textDir).filter(f => f.endsWith('.txt')).map(f => f.slice(0, -4)) : []
        return player.message(files.length ? `&eFiles: &f${files.join(', ')}` : '&eThere are no text files yet.')
      }
      const name = args[0].toLowerCase()
      if (!/^[a-z0-9_-]+$/.test(name)) throw new CommandError('Invalid file name.')
      const lines = readText(name)
      if (!lines) throw new CommandError(`config/text/${name}.txt does not exist.`)
      for (const line of lines) player.message(text.convertPercentCodes(line))
    }
  })

  // information

  const STATS = {
    blocks: ['Blocks placed', r => r.blocksPlaced],
    deleted: ['Blocks deleted', r => r.blocksDeleted],
    time: ['Time played', r => r.timeSpent, v => text.formatDuration(v)],
    logins: ['Logins', r => r.logins],
    messages: ['Messages', r => r.messages],
    kicks: ['Kicks', r => r.kicks]
  }
  ctx.command({
    name: 'top',
    aliases: ['leaderboard'],
    category: 'essentials',
    usage: `/top <${Object.keys(STATS).join('|')}>`,
    description: 'Shows the top 10 players',
    run (player, args, { usage }) {
      const stat = STATS[(args[0] || '').toLowerCase()]
      if (!stat) return usage()
      const [label, get, fmt = v => v.toLocaleString()] = stat
      const top = server.playerDB.all().filter(r => get(r) > 0).sort((a, b) => get(b) - get(a)).slice(0, 10)
      player.message(`&e${label}:`)
      top.forEach((r, i) => player.message(`&f${i + 1}. ${r.name} &7- ${fmt(get(r))}`))
      if (!top.length) player.message('&7Nobody yet.')
    }
  })

  ctx.command({
    name: 'search',
    aliases: ['find'],
    category: 'essentials',
    usage: '/search <players|commands|blocks|levels> <text>',
    description: 'Searches players, commands, blocks or levels by name',
    run (player, args, { usage }) {
      const what = (args[0] || '').toLowerCase()
      const q = (args[1] || '').toLowerCase()
      if (!q) return usage()
      let results
      if (what.startsWith('player')) results = server.playerDB.all().map(r => r.name)
      else if (what.startsWith('command')) results = server.commands.available(player).map(c => c.name)
      else if (what.startsWith('block')) {
        results = []
        for (let id = 0; id <= ctx.Blocks.MAX_BLOCK; id++) if (id <= ctx.Blocks.MAX_CPE || player.level.getBlockDef(id)) results.push(`${player.level.blockName(id)} (${id})`)
      } else if (what.startsWith('level')) results = server.levels.listFiles()
      else return usage()
      const found = results.filter(r => r.toLowerCase().includes(q))
      player.message(found.length ? `&eFound ${found.length}: &f${found.slice(0, 40).join(', ')}${found.length > 40 ? '...' : ''}` : '&eNothing found.')
    }
  })

  ctx.command({
    name: 'blocks',
    category: 'essentials',
    usage: '/blocks [custom]',
    description: 'Lists the blocks of this level',
    inGame: true,
    run (player, args) {
      const level = player.level
      const custom = (args[0] || '').toLowerCase() === 'custom'
      const list = []
      for (let id = custom ? ctx.Blocks.MAX_CPE + 1 : 1; id <= ctx.Blocks.MAX_BLOCK; id++) {
        if (id > ctx.Blocks.MAX_CPE && !level.getBlockDef(id)) continue
        list.push(`&f${id}&7:${level.blockName(id)}`)
      }
      player.message(list.length ? list.join('&7, ') : '&eNo custom blocks here.')
    }
  })

  ctx.command({
    name: 'pclients',
    aliases: ['clients'],
    category: 'essentials',
    usage: '/pclients',
    description: 'Shows which client each player is using',
    run (player) {
      const byClient = new Map()
      for (const p of server.online) {
        const key = p.appName + (p.conn.isWebSocket ? ' (web)' : '')
        byClient.set(key, [...(byClient.get(key) || []), p.name])
      }
      for (const [client, names] of byClient) player.message(`&f${client}&7: ${names.join(', ')}`)
    }
  })

  ctx.command({
    name: 'whonick',
    aliases: ['realname'],
    category: 'essentials',
    usage: '/whonick <nickname>',
    description: 'Finds out who is using a nickname',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      const q = args.join(' ').toLowerCase()
      const found = server.online.filter(p => p.record.nick && text.stripColors(p.record.nick).toLowerCase().includes(q))
      player.message(found.length ? found.map(p => `&f${p.record.nick}&e is &f${p.name}`).join('&7, ') : '&eNobody online uses that nickname.')
    }
  })

  ctx.command({
    name: 'lastcmd',
    aliases: ['last'],
    category: 'moderation',
    rank: 'Operator',
    usage: '/lastcmd [player]',
    description: 'Shows the last command a player used',
    run (player, args) {
      const targets = args[0] ? [find(player, args[0])] : server.online
      for (const t of targets) {
        const last = t.data.lastCommand
        player.message(`&f${t.name}&7: ${last ? `${last.line} (${text.formatDuration(Date.now() - last.at)} ago)` : 'no commands yet'}`)
      }
    }
  })

  ctx.command({
    name: 'tcolor',
    aliases: ['titlecolor'],
    category: 'essentials',
    rank: 'Operator',
    usage: '/tcolor <player> [color]',
    description: 'Sets the color of a player\'s title',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      const target = find(player, args[0])
      const color = args[1] ? text.parseColor(args[1]) : null
      if (args[1] && !color) throw new CommandError('Unknown color.')
      target.record.titleColor = color
      server.playerDB.save()
      target.respawnForOthers()
      player.message(`&eTitle color of ${target.name} ${color ? 'set' : 'reset'}.`)
    }
  })

  const setMessage = (field, label) => (player, args, { usage }) => {
    if (!args[0]) return usage()
    const record = server.playerDB.find(args[0])
    if (!record) throw new CommandError('Unknown player.')
    const self = !player.isConsole && record.name.toLowerCase() === player.name.toLowerCase()
    if (!self && !isOp(player)) throw new CommandError(`Only operators can change other players' ${label}.`)
    const msg = text.sanitize(text.convertPercentCodes(args.slice(1).join(' ')))
    if (msg.length > 60) throw new CommandError('That message is too long (60 characters max).')
    record[field] = msg || null
    server.playerDB.save()
    player.message(`&e${label[0].toUpperCase() + label.slice(1)} of ${record.name} ${msg ? 'set to: &f' + msg : 'reset'}`)
  }
  ctx.command({ name: 'loginmessage', aliases: ['loginmsg'], category: 'chat', rank: 'AdvBuilder', usage: '/loginmessage <player> [message]', description: 'Sets the message shown when a player joins', run: setMessage('loginMessage', 'login message') })
  ctx.command({ name: 'logoutmessage', aliases: ['logoutmsg'], category: 'chat', rank: 'AdvBuilder', usage: '/logoutmessage <player> [message]', description: 'Sets the message shown when a player leaves', run: setMessage('logoutMessage', 'logout message') })

  // CPE text colors and entity properties

  ctx.command({
    name: 'ccols',
    aliases: ['customcolors', 'customcolours'],
    category: 'chat',
    rank: 'Admin',
    usage: '/ccols <add <code> <hex>|remove <code>|list>',
    description: 'Adds custom chat color codes (e.g. &h) for clients that support TextColors',
    run (player, args, { usage }) {
      const sub = (args[0] || 'list').toLowerCase()
      const colors = server.config.customColors || (server.config.customColors = {})
      if (sub === 'list') {
        const list = Object.entries(colors).map(([c, hex]) => `&${c}${c} (#${hex})`)
        return player.message(list.length ? `&eCustom colors: ${list.join('&f, ')}` : '&eNo custom colors.')
      }
      const code = args[1]
      if (!code || code.length !== 1 || /[0-9a-f&%\s]/i.test(code)) throw new CommandError('The code must be one character that is not 0-9, a-f, & or %.')
      if (sub === 'add') {
        const hex = (args[2] || '').replace('#', '').toLowerCase()
        if (!/^[0-9a-f]{6}$/.test(hex)) return usage()
        colors[code] = hex
        text.extraColorCodes.add(code)
      } else if (sub === 'remove') {
        delete colors[code]
        text.extraColorCodes.delete(code)
      } else {
        return usage()
      }
      server.saveConfig()
      const n = parseInt(colors[code] || 'ffffff', 16)
      for (const p of server.online) {
        if (!p.supports('TextColors')) continue
        p.conn.write('setTextColor', { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: colors[code] ? 255 : 0, code: code.charCodeAt(0) })
      }
      player.message(sub === 'add' ? `&eAdded color &${code}${code}&e.` : `&eRemoved color ${code}.`)
    }
  })

  const setProperty = (player, target, key, value) => {
    target.data[key] = value
    target.respawnForOthers()
    // the player's own view only needs the property packets
    if (target.supports('EntityProperty')) {
      const scale = target.data.modelScale || 1
      const rot = target.data.entityRotation || [0, 0, 0]
      for (const type of [3, 4, 5]) target.conn.write('setEntityProperty', { id: -1, type, value: Math.round(scale * 1000) })
      rot.forEach((deg, type) => target.conn.write('setEntityProperty', { id: -1, type, value: Math.round(deg) }))
    }
    if (target !== player) player.message(`&eUpdated ${target.name}.`)
  }

  ctx.command({
    name: 'modelscale',
    aliases: ['scale'],
    category: 'essentials',
    rank: 'AdvBuilder',
    usage: '/modelscale <0.25-3> [player]',
    description: 'Makes you (or someone) bigger or smaller',
    inGame: true,
    run (player, args, { usage }) {
      const scale = Number(args[0])
      if (!(scale >= 0.25 && scale <= 3)) return usage()
      const target = args[1] ? find(player, args[1]) : player
      if (target !== player && !isOp(player)) throw new CommandError('Only operators can scale other players.')
      setProperty(player, target, 'modelScale', scale === 1 ? null : scale)
    }
  })

  ctx.command({
    name: 'entityrot',
    aliases: ['rotation'],
    category: 'essentials',
    rank: 'AdvBuilder',
    usage: '/entityrot <x|y|z> <degrees> [player]',
    description: 'Tilts how you (or someone) look',
    inGame: true,
    run (player, args, { usage }) {
      const axis = ['x', 'y', 'z'].indexOf((args[0] || '').toLowerCase())
      const deg = Number(args[1])
      if (axis === -1 || !Number.isFinite(deg)) return usage()
      const target = args[2] ? find(player, args[2]) : player
      if (target !== player && !isOp(player)) throw new CommandError('Only operators can rotate other players.')
      const rot = [...(target.data.entityRotation || [0, 0, 0])]
      rot[axis] = deg % 360
      setProperty(player, target, 'entityRotation', rot.some(v => v) ? rot : null)
    }
  })

  // offline mail

  const mail = ctx.loadData('inbox.json', {})
  const saveMail = () => ctx.saveData('inbox.json', mail)
  ctx.command({
    name: 'send',
    aliases: ['mail'],
    category: 'chat',
    usage: '/send <player> <message>',
    description: 'Leaves a message for a player, even if they are offline',
    run (player, args, { usage }) {
      if (args.length < 2) return usage()
      const record = server.playerDB.find(args[0])
      if (!record) throw new CommandError('Unknown player.')
      const box = mail[record.name.toLowerCase()] || (mail[record.name.toLowerCase()] = [])
      if (box.length >= 30) throw new CommandError(`${record.name}'s inbox is full.`)
      box.push({ from: player.isConsole ? 'Console' : player.name, message: text.sanitize(args.slice(1).join(' ')), at: Date.now() })
      saveMail()
      player.message(`&eMessage sent to ${record.name}.`)
      const online = server.findPlayerExact(record.name)
      if (online) online.message(`&eYou have a new message from ${player.name}. Type &f/inbox`)
    }
  })

  ctx.command({
    name: 'inbox',
    category: 'chat',
    usage: '/inbox [clear|del <number>]',
    description: 'Reads the messages people sent you with /send',
    inGame: true,
    run (player, args) {
      const key = player.name.toLowerCase()
      const box = mail[key] || []
      const sub = (args[0] || '').toLowerCase()
      if (sub === 'clear') { delete mail[key]; saveMail(); return player.message('&eInbox cleared.') }
      if (sub === 'del') {
        const i = Number(args[1]) - 1
        if (!box[i]) throw new CommandError('No message with that number.')
        box.splice(i, 1); saveMail()
        return player.message('&eMessage deleted.')
      }
      if (!box.length) return player.message('&eYour inbox is empty.')
      box.forEach((m, i) => player.message(`&f${i + 1}. &7[${text.formatDuration(Date.now() - m.at)} ago] &f${m.from}&7: ${m.message}`))
    }
  })
  ctx.on('playerJoin', ({ player }) => {
    const box = mail[player.name.toLowerCase()]
    if (box && box.length) player.message(`&eYou have ${box.length} message${box.length > 1 ? 's' : ''}. Type &f/inbox`)
  })
}
