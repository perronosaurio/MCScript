'use strict'

// Level maintenance commands from MCGalaxy: /copylvl /renamelvl /resizelvl /lockdown /reload /fixgrass /unflood

module.exports = function more (ctx, { levelArg }) {
  const { server, CommandError } = ctx
  const levels = server.levels

  ctx.command({
    name: 'copylvl',
    aliases: ['copylevel'],
    category: 'world',
    rank: 'Admin',
    usage: '/copylvl <level> <new name>',
    description: 'Makes a copy of a level',
    run (player, args, { usage }) {
      if (args.length < 2) return usage()
      levels.copy(args[0], args[1])
      player.message(`&aCopied ${args[0]} to ${args[1]}.`)
    }
  })

  ctx.command({
    name: 'renamelvl',
    aliases: ['renamelevel'],
    category: 'world',
    rank: 'Admin',
    usage: '/renamelvl <level> <new name>',
    description: 'Renames a level (its backups too)',
    run (player, args, { usage }) {
      if (args.length < 2) return usage()
      levels.rename(args[0], args[1])
      server.broadcast(`&eLevel ${args[0]} is now called &f${args[1]}&e.`)
    }
  })

  ctx.command({
    name: 'resizelvl',
    aliases: ['resizelevel'],
    category: 'world',
    rank: 'Admin',
    usage: '/resizelvl <width> <height> <length> [confirm]',
    description: 'Resizes your current level. Blocks outside the new size are lost',
    inGame: true,
    run (player, args, { usage }) {
      const [w, h, l] = args.slice(0, 3).map(Number)
      if (![w, h, l].every(v => Number.isInteger(v) && v >= 16 && v <= 8192)) return usage()
      const level = player.level
      const shrinking = w < level.width || h < level.height || l < level.length
      if (shrinking && (args[3] || '').toLowerCase() !== 'confirm') {
        return player.message(`&eThe level gets smaller and blocks will be lost. Type &f/resizelvl ${w} ${h} ${l} confirm&e (a backup is made first).`)
      }
      levels.backup(level)
      levels.resize(level, w, h, l)
      player.message(`&a${level.name} is now ${w}x${h}x${l}.`)
    }
  })

  ctx.on('playerChangeLevel', (ev) => {
    const locked = ev.to.meta.locked
    if (locked && ev.player.permission < server.ranks.permissionOf('Admin')) ev.cancel(`&c${ev.to.name} is locked.`)
  }, { priority: 'high' })

  ctx.command({
    name: 'lockdown',
    category: 'world',
    rank: 'Admin',
    usage: '/lockdown [level]',
    description: 'Locks a level so only admins can go there (toggle)',
    run (player, args) {
      const level = levelArg(player, args[0])
      level.meta.locked = !level.meta.locked
      level.dirty = true
      server.broadcast(`&e${level.name} is now ${level.meta.locked ? '&clocked' : '&aunlocked'}&e.`)
    }
  })

  ctx.command({
    name: 'reload',
    aliases: ['reveal'],
    category: 'world',
    usage: '/reload [all]',
    description: 'Sends the level to you again (operators: to everyone in it with "all")',
    run (player, args) {
      const all = (args[0] || '').toLowerCase() === 'all'
      if (all && player.permission < server.ranks.permissionOf('Operator')) throw new CommandError('Only operators can reload for everyone.')
      if (player.isConsole && !all) throw new CommandError('Use /reload all from the console.')
      const level = player.level
      const targets = all ? level.players : [player]
      for (const p of targets) p.reloadLevel()
    }
  })

  const transparent = new Set([0, 6, 8, 9, 18, 20, 37, 38, 39, 40, 44, 50, 51, 53, 54, 60])

  ctx.command({
    name: 'fixgrass',
    category: 'world',
    rank: 'Operator',
    usage: '/fixgrass [level]',
    description: 'Turns covered grass into dirt and uncovered dirt into grass',
    run (player, args) {
      const level = levelArg(player, args[0])
      const changes = []
      for (let x = 0; x < level.width; x++) {
        for (let z = 0; z < level.length; z++) {
          for (let y = 0; y < level.height; y++) {
            const b = level.getBlock(x, y, z)
            if (b !== 2 && b !== 3) continue
            const above = level.getBlock(x, y + 1, z)
            const lit = y === level.height - 1 || transparent.has(above)
            if (b === 2 && !lit) changes.push([x, y, z, 3])
            if (b === 3 && lit && above === 0) changes.push([x, y, z, 2])
          }
        }
      }
      level.setBlocks(changes)
      player.message(`&eFixed ${changes.length} grass and dirt blocks in ${level.name}.`)
    }
  })

  ctx.command({
    name: 'unflood',
    category: 'world',
    rank: 'Operator',
    usage: '/unflood [level]',
    description: 'Removes all flowing water and lava from a level',
    run (player, args) {
      const level = levelArg(player, args[0])
      const changes = []
      for (let i = 0; i < level.volume; i++) {
        const b = level.blocks[i]
        if ((b === 8 || b === 10) && !(level.upper && level.upper[i])) {
          const { x, y, z } = level.unpack(i)
          changes.push([x, y, z, 0])
        }
      }
      level.setBlocks(changes)
      player.message(`&eRemoved ${changes.length} flowing water and lava blocks.`)
    }
  })
}
