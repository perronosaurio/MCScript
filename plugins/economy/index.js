'use strict'

// Server money: earn it by playing, pay other players, and spend it in the shop
// on ranks, titles, name colors or a personal level.

module.exports = {
  name: 'economy',
  version: '1.0.0',
  description: 'Money, payments, income and a shop (ranks, titles, colors, personal levels)',
  author: 'MCScript',

  defaultConfig: {
    currency: 'coins',
    startBalance: 50,
    income: 10,
    incomeMinutes: 10,
    shop: {
      ranks: { Builder: 200, AdvBuilder: 1000 },
      title: 150,
      color: 100,
      level: { price: 500, width: 64, height: 64, length: 64, type: 'flat', maxPerPlayer: 1 }
    }
  },

  load (ctx) {
    const { server, config, text, CommandError } = ctx
    const data = ctx.loadData('balances.json', { balances: {}, levels: {} })
    const save = () => ctx.saveData('balances.json', data)
    const cur = config.currency
    const fmt = n => `&a${Math.floor(n).toLocaleString()} ${cur}&e`

    const key = name => String(name).toLowerCase()
    const balance = name => data.balances[key(name)] ?? config.startBalance
    const setBalance = (name, amount) => { data.balances[key(name)] = Math.max(0, Math.floor(amount)); save() }
    const add = (name, amount) => setBalance(name, balance(name) + amount)
    const take = (name, amount) => {
      if (balance(name) < amount) return false
      setBalance(name, balance(name) - amount)
      return true
    }
    const knownName = (name) => {
      const online = server.matchPlayers(name)
      if (online.length === 1) return online[0].name
      const record = server.playerDB.find(name)
      if (!record) throw new CommandError(`No player named "${name}" has joined this server.`)
      return record.name
    }
    const amountArg = (v) => {
      const n = Number(v)
      if (!Number.isInteger(n) || n <= 0) throw new CommandError('The amount must be a whole number above 0.')
      return n
    }

    // income for active players
    if (config.income > 0 && config.incomeMinutes > 0) {
      ctx.setInterval(() => {
        for (const p of server.online) {
          if (p.data['essentials.afk']) continue
          add(p.name, config.income)
          p.message(`&7+${config.income} ${cur} for playing`, 'bottom1')
        }
      }, config.incomeMinutes * 60000)
    }

    ctx.command({
      name: 'money',
      aliases: ['balance', 'bal', 'coins'],
      category: 'essentials',
      usage: '/money [player]',
      description: 'Shows how much money you (or someone else) have',
      run (player, args) {
        if (!args[0] && player.isConsole) throw new CommandError('Specify a player.')
        const name = args[0] ? knownName(args[0]) : player.name
        player.message(`&e${name} has ${fmt(balance(name))}.`)
      }
    })

    ctx.command({
      name: 'pay',
      category: 'essentials',
      usage: '/pay <player> <amount>',
      description: 'Gives some of your money to another player',
      inGame: true,
      run (player, args, { usage }) {
        if (args.length < 2) return usage()
        const target = knownName(args[0])
        if (target.toLowerCase() === player.name.toLowerCase()) throw new CommandError('You can\'t pay yourself.')
        const amount = amountArg(args[1])
        if (!take(player.name, amount)) throw new CommandError(`You only have ${text.stripColors(fmt(balance(player.name)))}.`)
        add(target, amount)
        player.message(`&eYou paid ${fmt(amount)} to ${target}.`)
        const online = server.findPlayerExact(target)
        if (online) online.message(`&e${player.coloredName}&e paid you ${fmt(amount)}.`)
      }
    })

    ctx.command({
      name: 'baltop',
      aliases: ['richest', 'moneytop'],
      category: 'essentials',
      usage: '/baltop',
      description: 'The richest players',
      run (player) {
        const top = Object.entries(data.balances).sort((a, b) => b[1] - a[1]).slice(0, 10)
        if (!top.length) return player.message('&eNobody has money yet.')
        player.message('&eRichest players:')
        top.forEach(([name, amount], i) => {
          const record = server.playerDB.get(name)
          player.message(`&f${i + 1}. ${record ? record.name : name} &7- ${fmt(amount)}`)
        })
      }
    })

    ctx.command({
      name: 'eco',
      aliases: ['economy'],
      category: 'moderation',
      rank: 'Admin',
      usage: '/eco <give|take|set> <player> <amount>',
      description: 'Changes a player\'s money',
      run (player, args, { usage }) {
        const action = (args[0] || '').toLowerCase()
        if (!['give', 'take', 'set'].includes(action) || args.length < 3) return usage()
        const target = knownName(args[1])
        const amount = action === 'set' ? Math.max(0, Number(args[2]) | 0) : amountArg(args[2])
        if (action === 'give') add(target, amount)
        else if (action === 'take') setBalance(target, balance(target) - amount)
        else setBalance(target, amount)
        player.message(`&e${target} now has ${fmt(balance(target))}.`)
      }
    })

    const giveTake = (sign) => (player, args, { usage }) => {
      if (args.length < 2) return usage()
      return server.commands.execute(player, `/eco ${sign > 0 ? 'give' : 'take'} ${args[0]} ${args[1]}`)
    }
    ctx.command({ name: 'give', category: 'moderation', rank: 'Admin', usage: '/give <player> <amount>', description: 'Gives money to a player', run: giveTake(1) })
    ctx.command({ name: 'take', category: 'moderation', rank: 'Admin', usage: '/take <player> <amount>', description: 'Takes money from a player', run: giveTake(-1) })

    // shop

    const shop = config.shop
    ctx.command({
      name: 'shop',
      aliases: ['store'],
      category: 'essentials',
      usage: '/shop',
      description: 'Lists what you can buy with /buy',
      run (player) {
        player.message(`&eShop (you have ${fmt(player.isConsole ? 0 : balance(player.name))}):`)
        for (const [rank, price] of Object.entries(shop.ranks || {})) {
          const r = server.ranks.get(rank)
          if (r) player.message(`&f/buy rank ${r.name} &7- ${r.color}${r.name}&7 rank for ${fmt(price)}`)
        }
        if (shop.title) player.message(`&f/buy title <title> &7- a title before your name for ${fmt(shop.title)}`)
        if (shop.color) player.message(`&f/buy color <color> &7- a name color for ${fmt(shop.color)}`)
        if (shop.level) player.message(`&f/buy level &7- your own ${shop.level.width}x${shop.level.height}x${shop.level.length} level for ${fmt(shop.level.price)}`)
      }
    })

    ctx.command({
      name: 'buy',
      category: 'essentials',
      usage: '/buy <rank|title|color|level> [value]',
      description: 'Buys something from the /shop',
      inGame: true,
      run (player, args, { usage }) {
        const item = (args[0] || '').toLowerCase()
        const value = args.slice(1).join(' ')
        const pay = (price) => {
          if (!take(player.name, price)) throw new CommandError(`That costs ${text.stripColors(fmt(price))}, you have ${text.stripColors(fmt(balance(player.name)))}.`)
        }

        if (item === 'rank') {
          const rank = server.ranks.get(value)
          const price = rank && shop.ranks && shop.ranks[rank.name]
          if (!price) throw new CommandError('That rank is not for sale. See /shop')
          if (player.permission >= rank.permission) throw new CommandError('You already have that rank or a higher one.')
          const next = server.ranks.next(player.rank)
          if (next !== rank) throw new CommandError(`You have to buy ${next ? next.name : 'the ranks'} first.`)
          pay(price)
          server.setRank(player.name, rank, 'shop')
          server.broadcast(`&e${player.coloredName}&e bought the ${rank.color}${rank.name}&e rank!`)
        } else if (item === 'title') {
          if (!shop.title) throw new CommandError('Titles are not for sale.')
          const title = text.stripColors(value)
          if (!title || title.length > 16) throw new CommandError('Give a title of up to 16 characters.')
          pay(shop.title)
          player.record.title = title
          server.playerDB.save()
          player.respawnForOthers()
          player.message(`&aYour title is now [${title}].`)
        } else if (item === 'color') {
          if (!shop.color) throw new CommandError('Colors are not for sale.')
          const color = text.parseColor(value)
          if (!color) throw new CommandError(`Unknown color. Use one of: ${Object.keys(text.COLORS).join(', ')}`)
          pay(shop.color)
          player.record.color = color
          server.playerDB.save()
          player.respawnForOthers()
          player.message(`&aYour name color is now ${color}this&a.`)
        } else if (item === 'level' || item === 'map') {
          const cfg = shop.level
          if (!cfg) throw new CommandError('Levels are not for sale.')
          const mine = (data.levels[key(player.name)] || []).filter(n => server.levels.exists(n))
          if (mine.length >= (cfg.maxPerPlayer || 1)) throw new CommandError(`You already own ${mine.join(', ')}.`)
          let name = `${player.name}`
          for (let n = 2; server.levels.exists(name); n++) name = `${player.name}${n}`
          pay(cfg.price)
          let level
          try {
            level = server.levels.create(name, { width: cfg.width, height: cfg.height, length: cfg.length, type: cfg.type, creator: player.name })
          } catch (err) {
            add(player.name, cfg.price) // refund
            throw err
          }
          level.owners = [key(player.name)]
          level.buildRank = server.ranks.highest.name // only owners (and the highest rank) build there
          level.dirty = true
          data.levels[key(player.name)] = [...mine, name]
          save()
          player.message(`&aYou bought the level &f${name}&a! Only you can build there. Use &f/goto ${name}&a.`)
        } else {
          return usage()
        }
      }
    })

    module.exports.api = { balance, add, take, setBalance, currency: cur }
  }
}
