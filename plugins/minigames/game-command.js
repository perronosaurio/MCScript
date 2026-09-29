'use strict'

// Builds the /<game> command shared by the round based games:
//   join [level], leave, start (force), stop, status, enable, disable + game specific setup commands

module.exports = function gameCommand (ctx, { name, aliases = [], title, metaKey, createRound, setup = {}, setupHelp = [] }) {
  const { server, CommandError } = ctx
  const rounds = new Map() // level name -> Round

  const configured = () => [...server.levels.loaded.values()].filter(l => l.meta[metaKey])

  // Arenas are remembered, so they are loaded at startup and /<game> join finds them from any level
  const arenaData = ctx.loadData('arenas.json', {})
  const arenas = new Set(arenaData[metaKey] || [])
  const saveArenas = () => { arenaData[metaKey] = [...arenas].sort(); ctx.saveData('arenas.json', arenaData) }
  const loadArena = (levelName) => {
    const level = server.levels.get(levelName)
    if (level) return level
    if (!server.levels.exists(levelName)) return null
    try { return server.levels.load(levelName) } catch (err) { ctx.log.warn(`Could not load ${title} arena ${levelName}: ${err.message}`); return null }
  }
  for (const levelName of arenas) loadArena(levelName)
  const roundFor = (level) => {
    let r = rounds.get(level.name)
    if (!r) { r = createRound(level); rounds.set(level.name, r) }
    return r
  }
  const roundOf = (player) => [...rounds.values()].find(r => r.has(player)) || null

  ctx.on('playerLeave', ({ player }) => { const r = roundOf(player); if (r) r.leave(player) })
  ctx.on('playerChangeLevel', ({ player, to }) => { const r = roundOf(player); if (r && r.level !== to) r.leave(player) }, { priority: 'monitor' })
  ctx.on('levelUnload', ({ level }) => { const r = rounds.get(level.name); if (r) { r.end(null, 'Level unloaded'); rounds.delete(level.name) } }, { priority: 'monitor' })
  ctx.onUnload(() => { for (const r of rounds.values()) r.end(null, 'Game stopped') })

  ctx.command({
    name,
    aliases,
    category: 'other',
    usage: `/${name} <join|leave|status|start|stop|enable|disable${Object.keys(setup).length ? '|' + Object.keys(setup).join('|') : ''}>`,
    description: `Play ${title}`,
    help: [`/${name} join [level] - join a game; /${name} leave`, 'Operators: enable (in the arena level), start, stop', ...setupHelp],
    inGame: true,
    async run (player, args, { usage }) {
      const sub = (args[0] || 'status').toLowerCase()
      const isOp = player.permission >= server.ranks.permissionOf('Operator')
      const needOp = () => { if (!isOp) throw new CommandError('Only operators can do that.') }

      switch (sub) {
        case 'join': {
          if (roundOf(player)) throw new CommandError(`You are already playing. Use /${name} leave`)
          let level = args[1] ? loadArena(args[1]) : null
          if (!level) level = player.level.meta[metaKey] ? player.level : configured()[0]
          if (!level || !level.meta[metaKey]) throw new CommandError(`There is no ${title} arena. An operator can create one with /${name} enable`)
          return roundFor(level).join(player)
        }
        case 'leave': {
          const r = roundOf(player)
          if (!r) throw new CommandError('You are not in a game.')
          return r.leave(player)
        }
        case 'status': {
          const list = configured()
          if (!list.length) return player.message(`&eNo ${title} arenas yet.`)
          for (const l of list) {
            const r = rounds.get(l.name)
            player.message(`&f${l.name}&7: ${r ? `${r.state}, ${r.players.size} player(s)` : 'waiting, 0 players'}`)
          }
          return
        }
        case 'enable':
          needOp()
          player.level.meta[metaKey] = player.level.meta[metaKey] || {}
          player.level.dirty = true
          arenas.add(player.level.name)
          saveArenas()
          return player.message(`&a${player.level.name} is now a ${title} arena. Players join with &f/${name} join`)
        case 'disable':
          needOp()
          if (rounds.get(player.level.name)) rounds.get(player.level.name).end(null, 'Arena disabled')
          delete player.level.meta[metaKey]
          player.level.dirty = true
          arenas.delete(player.level.name)
          saveArenas()
          return player.message(`&a${player.level.name} is no longer a ${title} arena.`)
        case 'start': {
          needOp()
          const r = rounds.get(player.level.name)
          if (!r || !r.players.size) throw new CommandError('Nobody has joined a game in this level.')
          if (r.running) throw new CommandError('The game is already running.')
          r.minPlayers = Math.min(r.minPlayers, r.players.size)
          return r.start()
        }
        case 'stop': {
          needOp()
          const r = rounds.get(player.level.name)
          if (!r) throw new CommandError('No game in this level.')
          return r.end(null, `Stopped by ${player.name}`)
        }
        default:
          if (setup[sub]) {
            needOp()
            if (!player.level.meta[metaKey]) throw new CommandError(`Use /${name} enable first.`)
            return setup[sub](player, args.slice(1), player.level.meta[metaKey])
          }
          return usage()
      }
    }
  })

  return { rounds, roundOf }
}
