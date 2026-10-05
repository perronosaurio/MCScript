'use strict'

// /like /dislike (level ratings, shown in /mapinfo) and /autoload, as in MCGalaxy

module.exports = function ratings (ctx) {
  const { server, CommandError } = ctx

  const ratingsOf = level => (level.meta.ratings = level.meta.ratings || { likes: [], dislikes: [] })
  const rate = (player, like) => {
    const level = player.level
    const r = ratingsOf(level)
    const name = player.name.toLowerCase()
    r.likes = r.likes.filter(n => n !== name)
    r.dislikes = r.dislikes.filter(n => n !== name)
    ;(like ? r.likes : r.dislikes).push(name)
    level.dirty = true
    player.message(`&eYou ${like ? '&aliked' : '&cdisliked'}&e ${level.name}. It has &a${r.likes.length}&e likes and &c${r.dislikes.length}&e dislikes.`)
  }
  ctx.command({ name: 'like', category: 'world', usage: '/like', description: 'Rates the level you are in', inGame: true, run (p) { rate(p, true) } })
  ctx.command({ name: 'dislike', category: 'world', usage: '/dislike', description: 'Rates the level you are in', inGame: true, run (p) { rate(p, false) } })

  ctx.command({
    name: 'autoload',
    category: 'world',
    rank: 'Admin',
    usage: '/autoload <level> [on|off] | /autoload list',
    description: 'Levels loaded when the server starts, besides the main one',
    run (player, args, { usage }) {
      const list = server.config.autoloadLevels || (server.config.autoloadLevels = [])
      if (!args[0]) return usage()
      if (args[0].toLowerCase() === 'list') {
        return player.message(list.length ? `&eLoaded at startup: &f${list.join(', ')}` : '&eNo levels are loaded at startup besides the main one.')
      }
      const name = server.levels.resolveName(args[0])
      if (!name) throw new CommandError(`There is no level called ${args[0]}.`)
      const on = (args[1] || 'on').toLowerCase() !== 'off'
      const i = list.findIndex(n => n.toLowerCase() === name.toLowerCase())
      if (on && i === -1) list.push(name)
      if (!on && i !== -1) list.splice(i, 1)
      server.saveConfig()
      if (on && !server.levels.get(name)) server.levels.load(name)
      player.message(on ? `&e${name} is loaded at startup.` : `&e${name} is no longer loaded at startup.`)
    }
  })

  return { ratingsOf }
}
