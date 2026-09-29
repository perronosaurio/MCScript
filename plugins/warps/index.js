'use strict'

// Named teleport points shared by everyone (/warp) and personal homes (/home).

module.exports = {
  name: 'warps',
  version: '1.0.0',
  description: 'Warps and homes',
  author: 'MCScript',

  defaultConfig: {
    maxHomes: { Guest: 1, Builder: 3, AdvBuilder: 5, Operator: 20 }
  },

  load (ctx) {
    const { server, config, CommandError } = ctx
    const data = ctx.loadData('warps.json', { warps: {}, homes: {} })
    const save = () => ctx.saveData('warps.json', data)

    const here = (player) => ({ level: player.level.name, ...player.feetPos, yaw: player.yaw, pitch: player.pitch })

    const go = (player, point, label) => {
      let level = server.levels.get(point.level)
      if (!level) {
        if (!server.levels.exists(point.level)) throw new CommandError(`The level of ${label} no longer exists.`)
        level = server.levels.load(point.level)
      }
      if (player.level !== level && !player.changeLevel(level)) return
      player.teleport(point.x, point.y, point.z, point.yaw, point.pitch)
      player.message(`&eTeleported to &f${label}&e.`)
    }

    const maxHomes = (player) => {
      let max = 0
      for (const [rank, n] of Object.entries(config.maxHomes)) {
        if (player.permission >= server.ranks.permissionOf(rank)) max = Math.max(max, n)
      }
      return max
    }

    ctx.command({
      name: 'warp',
      aliases: ['warps'],
      category: 'essentials',
      usage: '/warp <name> | /warp list | /warp create <name> | /warp delete <name>',
      description: 'Teleports to a warp point',
      run (player, args, { usage }) {
        const sub = (args[0] || 'list').toLowerCase()
        const name = (args[1] || '').toLowerCase()
        const isOp = player.permission >= server.ranks.permissionOf('Operator')

        if (sub === 'list') {
          const names = Object.keys(data.warps).sort()
          return player.message(names.length ? `&eWarps: &f${names.join(', ')}` : '&eThere are no warps yet.')
        }
        if (sub === 'create' || sub === 'add' || sub === 'set') {
          if (!isOp) throw new CommandError('Only operators can create warps.')
          if (player.isConsole) throw new CommandError('Use this in-game.')
          if (!/^[a-z0-9_-]{1,24}$/.test(name)) return usage()
          data.warps[name] = { ...here(player), by: player.name }
          save()
          return player.message(`&aWarp &f${name}&a created.`)
        }
        if (sub === 'delete' || sub === 'remove' || sub === 'del') {
          if (!isOp) throw new CommandError('Only operators can delete warps.')
          if (!data.warps[name]) throw new CommandError('That warp does not exist.')
          delete data.warps[name]
          save()
          return player.message(`&aWarp ${name} deleted.`)
        }
        if (player.isConsole) throw new CommandError('Use this in-game.')
        const warp = data.warps[sub]
        if (!warp) throw new CommandError(`Unknown warp "${sub}". See /warp list`)
        go(player, warp, `warp ${sub}`)
      }
    })

    ctx.command({
      name: 'home',
      aliases: ['homes'],
      category: 'essentials',
      usage: '/home [name] | /home set [name] | /home delete [name] | /home list',
      description: 'Your personal teleport points',
      inGame: true,
      run (player, args) {
        const key = player.name.toLowerCase()
        const homes = data.homes[key] || (data.homes[key] = Object.create(null))
        const sub = (args[0] || '').toLowerCase()
        const name = (args[1] || 'home').toLowerCase()

        if (sub === 'list') {
          const names = Object.keys(homes)
          return player.message(names.length ? `&eYour homes (${names.length}/${maxHomes(player)}): &f${names.join(', ')}` : '&eYou have no homes. Use /home set')
        }
        if (sub === 'set') {
          if (!homes[name] && Object.keys(homes).length >= maxHomes(player)) throw new CommandError(`You can have at most ${maxHomes(player)} homes.`)
          if (!/^[a-z0-9_-]{1,24}$/.test(name)) throw new CommandError('Invalid home name.')
          homes[name] = here(player)
          save()
          return player.message(`&aHome &f${name}&a set.`)
        }
        if (sub === 'delete' || sub === 'del' || sub === 'remove') {
          if (!homes[name]) throw new CommandError('You have no home with that name.')
          delete homes[name]
          save()
          return player.message(`&aHome ${name} deleted.`)
        }
        const target = homes[sub || 'home'] || (!sub && Object.values(homes)[0])
        if (!target) throw new CommandError(sub ? `You have no home named ${sub}.` : 'You have no home. Use /home set')
        go(player, target, 'home')
      }
    })
  }
}
