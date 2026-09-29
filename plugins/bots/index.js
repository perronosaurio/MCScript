'use strict'

// NPC bots: named entities with a skin and model that stand in a level.
// AI "look" makes the bot face the nearest player; "wander" walks around slowly.
// Bots are stored in the level (level.meta.bots) and respawn when the level loads.

module.exports = {
  name: 'bots',
  version: '1.0.0',
  description: 'NPC bots with skins, models and simple AI',
  author: 'MCScript',

  load (ctx) {
    const { server, CommandError, text } = ctx
    const live = new Map() // level name -> Map(bot name -> entity)

    const savedOf = level => (level.meta.bots = level.meta.bots || {})
    const liveOf = level => {
      let m = live.get(level.name)
      if (!m) live.set(level.name, (m = new Map()))
      return m
    }

    const spawnBot = (level, key, bot) => {
      const entity = server.createEntity({
        name: bot.display || bot.name,
        skin: bot.skin,
        model: bot.model,
        scale: bot.scale || null,
        level,
        x: bot.x,
        y: bot.y,
        z: bot.z,
        yaw: bot.yaw,
        pitch: bot.pitch,
        data: { bot: key }
      })
      liveOf(level).set(key, entity)
      return entity
    }

    const spawnAll = (level) => {
      for (const [key, bot] of Object.entries(savedOf(level))) {
        if (!liveOf(level).has(key)) spawnBot(level, key, bot)
      }
    }

    const despawnAll = (level) => {
      for (const entity of liveOf(level).values()) server.removeEntity(entity)
      live.delete(level.name)
    }

    for (const level of server.levels.loaded.values()) spawnAll(level)
    ctx.on('levelLoad', ({ level }) => spawnAll(level))
    ctx.on('levelUnload', ({ level }) => despawnAll(level), { priority: 'monitor' })
    ctx.onUnload(() => { for (const level of server.levels.loaded.values()) despawnAll(level) })

    // AI tick
    ctx.setInterval(() => {
      for (const [levelName, bots] of live) {
        const level = server.levels.get(levelName)
        if (!level) continue
        const players = level.players.filter(p => p.spawned && !p.hidden)
        for (const [key, entity] of bots) {
          const bot = savedOf(level)[key]
          if (!bot || !bot.ai || bot.ai === 'none') continue
          if (bot.ai === 'look' && players.length) {
            let nearest = null; let best = Infinity
            for (const p of players) {
              const d = Math.hypot(p.pos.x - entity.pos.x, p.pos.y - entity.pos.y, p.pos.z - entity.pos.z)
              if (d < best) { best = d; nearest = p }
            }
            if (nearest && best < 32 * 16) {
              const dx = nearest.pos.x - entity.pos.x; const dz = nearest.pos.z - entity.pos.z
              const dy = nearest.pos.y - entity.pos.y
              const yaw = Math.round(((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360 * 256 / 360)
              const pitch = Math.round(((-Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI) + 360) % 360 * 256 / 360)
              if (yaw !== entity.yaw || pitch !== entity.pitch) server.rotateEntity(entity, yaw, pitch)
            }
          } else if (bot.ai === 'wander') {
            entity.data.angle = (entity.data.angle ?? Math.random() * Math.PI * 2) + (Math.random() - 0.5) * 0.6
            const x = entity.pos.x / 32 + Math.sin(entity.data.angle) * 0.25
            const z = entity.pos.z / 32 - Math.cos(entity.data.angle) * 0.25
            // stay within 6 blocks of home, on the ground
            if (Math.hypot(x - bot.x, z - bot.z) > 6 || !level.inBounds(Math.floor(x), 0, Math.floor(z))) {
              entity.data.angle += Math.PI
              continue
            }
            const y = level.highestFreeY(Math.floor(x), Math.floor(z))
            if (Math.abs(y - (entity.pos.y - 51) / 32) > 1.1) { entity.data.angle += Math.PI / 2; continue }
            const yaw = Math.round(((entity.data.angle * 180 / Math.PI) % 360 + 360) % 360 * 256 / 360)
            server.moveEntity(entity, x, y, z, yaw, 0)
          }
        }
      }
    }, 200)

    const findBot = (level, name) => {
      const key = String(name || '').toLowerCase()
      const bot = savedOf(level)[key]
      if (!bot) throw new CommandError(`No bot named "${name}" in this level.`)
      return [key, bot]
    }

    const respawn = (level, key) => {
      const entity = liveOf(level).get(key)
      if (entity) { server.removeEntity(entity); liveOf(level).delete(key) }
      spawnBot(level, key, savedOf(level)[key])
    }

    ctx.command({
      name: 'bot',
      aliases: ['bots', 'npc'],
      category: 'world',
      rank: 'Operator',
      usage: '/bot <add|remove|list|summon|model|skin|name|ai|scale> <name> [value]',
      description: 'Creates and controls NPC bots',
      help: [
        '/bot add <name> [skin] - creates a bot at your position',
        '/bot model <name> <model>, /bot skin <name> <skin>, /bot name <name> <display name>',
        '/bot ai <name> <none|look|wander>, /bot scale <name> <0.25-3>, /bot summon <name>, /bot remove <name>'
      ],
      inGame: true,
      run (player, args, { usage }) {
        const level = player.level
        const sub = (args[0] || '').toLowerCase()
        const name = args[1]
        const value = args.slice(2).join(' ')

        if (sub === 'list') {
          const names = Object.values(savedOf(level)).map(b => `${b.name}&7(${b.ai || 'none'})&f`)
          return player.message(names.length ? `&eBots here: &f${names.join(', ')}` : '&eNo bots in this level.')
        }
        if (!name) return usage()

        switch (sub) {
          case 'add':
          case 'create': {
            if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) throw new CommandError('Bot names can use letters, numbers and _ (max 16).')
            const key = name.toLowerCase()
            if (savedOf(level)[key]) throw new CommandError('A bot with that name already exists here.')
            const p = player.feetPos
            savedOf(level)[key] = { name, display: '&e' + name, skin: args[2] || name, model: 'humanoid', ai: 'look', x: p.x, y: p.y, z: p.z, yaw: player.yaw, pitch: 0 }
            level.dirty = true
            spawnBot(level, key, savedOf(level)[key])
            return player.message(`&aBot ${name} created. It looks at players nearby (/bot ai ${name} none to stop).`)
          }
          case 'remove':
          case 'delete': {
            const [key] = findBot(level, name)
            const entity = liveOf(level).get(key)
            if (entity) server.removeEntity(entity)
            liveOf(level).delete(key)
            delete savedOf(level)[key]
            level.dirty = true
            return player.message(`&aBot ${name} removed.`)
          }
          case 'summon':
          case 'tp': {
            const [key, bot] = findBot(level, name)
            Object.assign(bot, player.feetPos, { yaw: player.yaw })
            level.dirty = true
            const entity = liveOf(level).get(key)
            server.moveEntity(entity, bot.x, bot.y, bot.z, bot.yaw, 0)
            return player.message(`&aBot ${name} moved to you.`)
          }
          case 'model':
          case 'skin':
          case 'name':
          case 'display': {
            const [key, bot] = findBot(level, name)
            if (!value) return usage()
            if (sub === 'model') bot.model = value.toLowerCase()
            else if (sub === 'skin') bot.skin = value
            else bot.display = text.convertPercentCodes(value)
            level.dirty = true
            respawn(level, key)
            return player.message(`&aBot ${name} updated.`)
          }
          case 'scale': {
            const [key, bot] = findBot(level, name)
            const scale = Number(value)
            if (!(scale >= 0.25 && scale <= 3)) throw new CommandError('Scale must be between 0.25 and 3.')
            bot.scale = scale
            level.dirty = true
            respawn(level, key)
            return player.message(`&aBot ${name} scaled to ${scale}.`)
          }
          case 'ai': {
            const [, bot] = findBot(level, name)
            const ai = (value || '').toLowerCase()
            if (!['none', 'look', 'wander'].includes(ai)) throw new CommandError('AI: none, look or wander.')
            bot.ai = ai
            level.dirty = true
            return player.message(`&aBot ${name} AI set to ${ai}.`)
          }
          default:
            return usage()
        }
      }
    })
  }
}
