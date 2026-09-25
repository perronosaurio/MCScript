'use strict'

// Particle effects (CPE CustomParticles), cinematic bars (CinematicGui) and opening the block
// inventory (ToggleBlockList). Effects are defined in config/plugins/effects.json.

// "texture" is [u1, v1, u2, v2] inside particles.png in 1/256 units ([0, 0, 15, 15] = first 8x8 icon)
const DEFAULT_EFFECTS = {
  sparkle: { texture: [0, 0, 15, 15], tint: [255, 230, 90], count: 20, size: 0.2, spread: 0.8, speed: 1.2, gravity: -0.3, lifetime: 0.8, fullBright: true, collide: false },
  smoke: { texture: [0, 0, 15, 15], tint: [120, 120, 120], count: 30, size: 0.5, spread: 1, speed: 0.6, gravity: -1, lifetime: 1.5 },
  hearts: { texture: [0, 0, 15, 15], tint: [255, 80, 140], count: 8, size: 0.35, spread: 0.6, speed: 0.4, gravity: -0.6, lifetime: 1.2, fullBright: true, collide: false },
  fire: { texture: [0, 0, 15, 15], tint: [255, 120, 20], count: 25, size: 0.3, spread: 0.4, speed: 0.8, gravity: -1.5, lifetime: 0.7, fullBright: true },
  snow: { texture: [0, 0, 15, 15], tint: [240, 245, 255], count: 40, size: 0.15, spread: 3, speed: 0.2, gravity: 2, lifetime: 3, expireOnGround: true },
  magic: { texture: [0, 0, 15, 15], tint: [170, 90, 255], count: 35, size: 0.25, spread: 1.2, speed: 2, gravity: 0, lifetime: 0.6, fullBright: true, collide: false }
}

module.exports = {
  name: 'effects',
  version: '1.0.0',
  description: 'Particle effects, cinematic bars and inventory control',
  author: 'MCScript',

  defaultConfig: {
    joinEffect: 'sparkle',
    explosionEffect: 'smoke',
    effects: DEFAULT_EFFECTS
  },

  load (ctx) {
    const { server, config, CommandError } = ctx
    for (const [name, effect] of Object.entries({ ...DEFAULT_EFFECTS, ...config.effects })) server.defineParticle(name, effect)

    const at = (player) => ({ ...player.feetPos, y: player.feetPos.y + 1 })

    if (config.joinEffect) {
      ctx.on('playerSpawn', ({ player, level }) => {
        ctx.setTimeout(() => {
          if (!player.spawned || player.level !== level) return
          const p = at(player)
          server.spawnParticles(level, config.joinEffect, p.x, p.y, p.z)
        }, 1500)
      })
    }
    if (config.explosionEffect) {
      ctx.on('explosion', ({ level, x, y, z }) => server.spawnParticles(level, config.explosionEffect, x + 0.5, y + 0.5, z + 0.5))
    }

    const findTarget = (player, name) => {
      if (!name) return player
      const target = server.findPlayer(name, player)
      if (!target) throw new CommandError('Player not found.')
      return target
    }

    ctx.command({
      name: 'effect',
      aliases: ['particles', 'fx'],
      category: 'other',
      rank: 'Builder',
      usage: '/effect <name|list> [player]',
      description: 'Shows a particle effect at your position (or at a player)',
      inGame: true,
      run (player, args, { usage }) {
        const name = (args[0] || '').toLowerCase()
        if (!name) return usage()
        if (name === 'list') return player.message(`&eEffects: &f${[...server.particleEffects.keys()].join(', ')}`)
        if (!server.particleEffects.has(name)) throw new CommandError(`Unknown effect. Effects: ${[...server.particleEffects.keys()].join(', ')}`)
        const target = findTarget(player, args[1])
        const p = at(target)
        server.spawnParticles(target.level, name, p.x, p.y, p.z)
        if (!player.supports('CustomParticles')) player.message('&7(Your client does not show custom particles.)')
      }
    })

    ctx.command({
      name: 'cinematic',
      aliases: ['bars'],
      category: 'other',
      rank: 'Operator',
      usage: '/cinematic <on|off> [player|all]',
      description: 'Shows black cinematic bars and hides the HUD',
      run (player, args, { usage }) {
        const mode = (args[0] || '').toLowerCase()
        if (!['on', 'off'].includes(mode)) return usage()
        const targets = (args[1] || '').toLowerCase() === 'all' ? server.online : [findTarget(player, args[1] || (player.isConsole ? null : player.name))]
        const on = mode === 'on'
        let shown = 0
        for (const t of targets) if (t.setCinematic({ hideCrosshair: on, hideHand: on, hideHotbar: on, barSize: on ? 0.12 : 0 })) shown++
        player.message(`&eCinematic mode ${on ? 'on' : 'off'} for ${shown} player(s).`)
      }
    })

    ctx.command({
      name: 'blocklist',
      aliases: ['inventory'],
      category: 'other',
      rank: 'Operator',
      usage: '/blocklist <open|close> [player]',
      description: 'Opens or closes the block inventory of a player',
      run (player, args, { usage }) {
        const mode = (args[0] || '').toLowerCase()
        if (!['open', 'close'].includes(mode)) return usage()
        const target = findTarget(player, args[1] || (player.isConsole ? null : player.name))
        if (!target.toggleBlockList(mode === 'open')) throw new CommandError('That client does not support this.')
      }
    })

    // log what clients report through NotifyAction (useful for plugins)
    ctx.on('notifyAction', ({ player, action, value }) => ctx.log.debug(`${player.name}: ${action} ${value ?? ''}`))
  }
}
