'use strict'

// Example plugin: a tour of the MCScript plugin API. Copy it (or use /pcreate <name>) to start your own.
// Full reference: docs/PLUGINS.md

module.exports = {
  name: 'example',
  version: '1.0.0',
  description: 'Example plugin showing commands, events, config, data and CPE features',
  author: 'MCScript',

  // Written to config/plugins/example.json the first time. Edit that file and /preload example.
  defaultConfig: {
    greeting: '&aHello, {player}!',
    blockTntNearSpawn: true,
    tntSafeRadius: 20
  },

  load (ctx) {
    const { server, config, log, CommandError } = ctx

    // Persistent data lives in data/plugins/example/*.json
    const stats = ctx.loadData('stats.json', { joins: {} })

    // 1) A simple command
    ctx.command({
      name: 'hello',
      aliases: ['hi'],
      category: 'other',
      usage: '/hello [player]',
      description: 'Says hello (example plugin)',
      run (player, args) {
        const target = args[0] ? server.findPlayer(args[0], player) : player
        if (!target) return // findPlayer already told the player what went wrong
        target.message(config.greeting.replace('{player}', target.name))
        // Message types (CPE MessageTypes): 'announce' shows in the middle of the screen
        target.message(`&eWave from ${player.coloredName}`, 'smallAnnounce')
      }
    })

    // 2) Events: count joins and show a status message (top right corner)
    ctx.on('playerJoin', ({ player }) => {
      const key = player.name.toLowerCase()
      stats.joins[key] = (stats.joins[key] || 0) + 1
      ctx.saveData('stats.json', stats)
      player.message(`&7Visit #${stats.joins[key]}`, 'status1')
    })

    // 3) Cancelling events: no TNT close to spawn (except for operators)
    ctx.on('blockChange', (ev) => {
      if (!config.blockTntNearSpawn || !ev.placing || ev.block !== 46) return
      if (ev.player.permission >= server.ranks.permissionOf('Operator')) return
      const s = ev.level.spawn
      if (Math.hypot(ev.x - s.x, ev.z - s.z) < config.tntSafeRadius) ev.cancel('&cNo TNT near the spawn!')
    })

    // 4) CPE: launch the player into the air (VelocityControl)
    ctx.command({
      name: 'launch',
      category: 'other',
      rank: 'Builder',
      usage: '/launch [power 1-10]',
      description: 'Launches you into the air',
      inGame: true,
      run (player, args) {
        const power = Math.max(1, Math.min(10, Number(args[0]) || 3))
        if (!player.setVelocity(0, power, 0, { addX: true, addZ: true })) {
          throw new CommandError('Your client does not support VelocityControl.')
        }
      }
    })

    // 5) Selections + timers: highlight an area for 10 seconds
    ctx.command({
      name: 'highlight',
      category: 'other',
      usage: '/highlight',
      description: 'Marks two corners and shows a colored box for 10 seconds',
      inGame: true,
      async run (player) {
        let marks
        try {
          marks = await player.selectBlocks(2, 'Highlight')
        } catch (err) {
          return // cancelled with /abort
        }
        player.showSelection(1, 'Highlight', marks[0], marks[1], [0, 200, 255, 90])
        ctx.setTimeout(() => player.hideSelection(1), 10000) // timers are cleared if the plugin unloads
      }
    })

    // 6) Expose an API that other plugins can use via ctx.getPlugin('example')
    module.exports.api = {
      joinsOf: name => stats.joins[name.toLowerCase()] || 0
    }

    log.info(`Loaded with ${Object.keys(stats.joins).length} known players`)
  },

  unload (ctx) {
    // Commands, events and timers are removed automatically; clean up anything else here.
    ctx.log.info('Bye!')
  }
}
