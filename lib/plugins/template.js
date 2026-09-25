'use strict'

// Source for a new plugin, used by /pcreate and `npm run plugin:create <name>`
module.exports = function pluginTemplate (name, author = 'unknown') {
  return `'use strict'

// ${name} - created with MCScript's plugin generator.
// Documentation: docs/PLUGINS.md

module.exports = {
  name: '${name}',
  version: '1.0.0',
  description: 'Describe what ${name} does',
  author: '${author}',

  // Saved to config/plugins/${name}.json the first time the plugin loads
  defaultConfig: {
    greeting: '&aHello from ${name}!'
  },

  load (ctx) {
    const { server, config, log } = ctx

    // Commands are removed automatically when the plugin is unloaded
    ctx.command({
      name: '${name.toLowerCase()}',
      description: 'Example command of ${name}',
      usage: '/${name.toLowerCase()} [player]',
      rank: 'Guest',
      run (player, args) {
        const target = args[0] ? server.findPlayer(args[0], player) : player
        if (!target) return
        target.message(config.greeting)
      }
    })

    // Events are also cleaned up automatically. Use ev.cancel() to prevent the action.
    ctx.on('playerJoin', ({ player }) => {
      log.info(\`\${player.name} joined\`)
    })

    log.info('Enabled!')
  },

  unload (ctx) {
    ctx.log.info('Disabled!')
  }
}
`
}
