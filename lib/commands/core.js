'use strict'

const fs = require('fs')
const path = require('path')
const pluginTemplate = require('../plugins/template')
const installer = require('../plugins/installer')
const { CommandError } = require('./manager')

const CATEGORIES = {
  essentials: 'Basic commands',
  chat: 'Chat and messages',
  moderation: 'Moderation',
  building: 'Building and drawing',
  world: 'Levels and environment',
  blocks: 'Custom blocks',
  server: 'Server management',
  other: 'Other'
}

// Commands that belong to the server itself (they can't be unloaded)
module.exports = function registerCoreCommands (server) {
  const { commands, plugins, ranks } = server

  commands.register({
    name: 'help',
    aliases: ['commands', 'cmds', 'cmdlist'],
    category: 'essentials',
    usage: '/help [command|category|all]',
    description: 'Shows the commands you can use',
    run (player, args) {
      const query = (args[0] || '').toLowerCase()
      const available = commands.available(player)

      if (!query) {
        player.message('&eCommand categories:')
        for (const [key, desc] of Object.entries(CATEGORIES)) {
          const n = available.filter(c => c.category === key).length
          if (n) player.message(`  &f/help ${key} &7- ${desc} (${n})`)
        }
        player.message('&eUse &f/help <command>&e for details, or &f/help all&e for everything.')
        return
      }

      if (query === 'all' || CATEGORIES[query]) {
        const list = query === 'all' ? available : available.filter(c => c.category === query)
        if (!list.length) return player.message('&cNo commands available in that category.')
        player.message(`&e${query === 'all' ? 'All commands' : CATEGORIES[query]}:`)
        player.message('&f' + list.map(c => {
          const rank = ranks.get(commands.permissionFor(c))
          return (rank ? rank.color : '&f') + c.name
        }).join('&7, '))
        return
      }

      const cmd = commands.find(query)
      if (!cmd) return player.message(`&cNo command named "${query}".`)
      const rank = ranks.get(commands.permissionFor(cmd))
      player.message(`&e${cmd.usage}`)
      if (cmd.description) player.message(`&7${cmd.description}`)
      if (cmd.help) for (const line of [].concat(cmd.help)) player.message(`&7${line}`)
      const extra = []
      if (cmd.aliases.length) extra.push(`aliases: /${cmd.aliases.join(', /')}`)
      if (rank) extra.push(`rank: ${rank.color}${rank.name}&7+`)
      if (cmd.owner) extra.push(`plugin: ${cmd.owner}`)
      if (extra.length) player.message(`&7(${extra.join(' &8| &7')})`)
    }
  })

  commands.register({
    name: 'plugins',
    aliases: ['pl', 'plist'],
    category: 'server',
    usage: '/plugins',
    description: 'Lists loaded plugins',
    run (player) {
      const loaded = plugins.list()
      const all = [...plugins.discover().keys()]
      player.message(`&ePlugins (${loaded.length}/${all.length} loaded):`)
      player.message(all.sort().map(name => {
        const p = plugins.get(name)
        if (p) return `&a${p.name}${p.module.version ? '&7 v' + p.module.version : ''}`
        return plugins.isDisabled(name) ? `&8${name} (off)` : `&c${name}`
      }).join('&7, '))
      player.message('&7Green: loaded, red: failed or unloaded, grey: turned off with /pdisable.')
    }
  })

  commands.register({
    name: 'pload',
    category: 'server',
    rank: 'Owner',
    usage: '/pload <plugin>',
    description: 'Loads a plugin from the plugins folder',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      const p = plugins.load(args[0])
      player.message(`&aLoaded plugin ${p.name}.`)
    }
  })

  commands.register({
    name: 'punload',
    category: 'server',
    rank: 'Owner',
    usage: '/punload <plugin>',
    description: 'Unloads a plugin',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      plugins.unload(args[0])
      player.message(`&aUnloaded plugin ${args[0]}.`)
    }
  })

  commands.register({
    name: 'preload',
    category: 'server',
    rank: 'Owner',
    usage: '/preload <plugin>',
    description: 'Reloads a plugin (applies code and config changes)',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      const p = plugins.reload(args[0])
      player.message(`&aReloaded plugin ${p.name}.`)
    }
  })

  commands.register({
    name: 'pcreate',
    category: 'server',
    rank: 'Owner',
    usage: '/pcreate <name>',
    description: 'Creates a new plugin from a template in plugins/<name>/index.js',
    run (player, args, { usage }) {
      const name = args[0]
      if (!name) return usage()
      if (!/^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(name)) return player.message('&cInvalid plugin name.')
      const dir = path.join(plugins.dir, name)
      if (fs.existsSync(dir) || fs.existsSync(dir + '.js')) return player.message('&cA plugin with that name already exists.')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'index.js'), pluginTemplate(name, player.isConsole ? 'console' : player.name))
      player.message(`&aCreated plugins/${name}/index.js. Edit it, then use &f/pload ${name}&a.`)
    }
  })

  commands.register({
    name: 'pinstall',
    category: 'server',
    rank: 'Owner',
    usage: '/pinstall <url to .js | npm:package[@version]> [noload]',
    description: 'Installs a plugin from a URL (GitHub links work) or from npm, and loads it',
    help: ['npm packages are installed without running their install scripts.'],
    async run (player, args, { usage }) {
      const source = args[0]
      if (!source) return usage()
      player.message('&eInstalling...')
      const name = source.startsWith('npm:')
        ? await installer.installFromNpm(plugins.dir, source.slice(4))
        : await installer.installFromUrl(plugins.dir, source)
      server.log.info(`${player.name} installed plugin ${name} from ${source}`)
      if ((args[1] || '').toLowerCase() === 'noload') return player.message(`&aInstalled ${name}. Use &f/pload ${name}&a to start it.`)
      const p = plugins.load(name)
      player.message(`&aInstalled and loaded ${p.name}${p.module.version ? ' v' + p.module.version : ''}.`)
    }
  })

  commands.register({
    name: 'puninstall',
    category: 'server',
    rank: 'Owner',
    usage: '/puninstall <plugin>',
    description: 'Unloads a plugin and moves it to plugins/.removed',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      const loaded = plugins.get(args[0])
      if (loaded) plugins.unload(loaded.name)
      installer.uninstall(plugins.dir, loaded ? path.basename(loaded.file) === 'index.js' ? path.basename(path.dirname(loaded.file)) : path.basename(loaded.file, '.js') : args[0])
      player.message(`&aRemoved ${args[0]} (a copy was kept in plugins/.removed).`)
    }
  })

  commands.register({
    name: 'cmdset',
    category: 'server',
    rank: 'Owner',
    usage: '/cmdset <command> <rank>',
    description: 'Changes the minimum rank needed to use a command',
    run (player, args, { usage }) {
      const cmd = commands.find(args[0])
      const rank = ranks.get(args[1])
      if (!cmd || !rank) return usage()
      commands.setOverride(cmd.name, rank.name)
      player.message(`&a/${cmd.name} can now be used by ${rank.color}${rank.name}&a+.`)
    }
  })

  commands.register({
    name: 'blockset',
    category: 'server',
    rank: 'Owner',
    usage: '/blockset <block> <place|delete> <rank>',
    description: 'Changes the minimum rank needed to place or delete a block',
    run (player, args, { usage }) {
      const level = player.level
      const block = level.parseBlock(args[0])
      const action = (args[1] || '').toLowerCase()
      const rank = ranks.get(args[2])
      if (block === null || !['place', 'delete'].includes(action) || !rank) return usage()
      server.blockPerms.set(block, action, rank.name)
      player.message(`&a${rank.color}${rank.name}&a+ can now ${action} ${level.blockName(block)}.`)
    }
  })

  commands.register({
    name: 'abort',
    aliases: ['a'],
    category: 'building',
    usage: '/abort',
    description: 'Cancels the current block selection or toggle mode',
    inGame: true,
    run (player) {
      const cancelled = player.cancelSelection()
      server.events.fire('playerAbort', { player })
      player.message(cancelled ? '&eSelection cancelled.' : '&eAll modes reset.')
    }
  })

  // MCGalaxy style: /plugin <list|load|unload|reload|create|install|uninstall> [name]
  commands.register({
    name: 'pdisable',
    category: 'server',
    rank: 'Owner',
    usage: '/pdisable <plugin>',
    description: 'Turns a plugin off and keeps it off after restarts',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      try { plugins.disable(args[0]) } catch (err) { throw new CommandError(err.message) }
      player.message(`&ePlugin ${args[0]} turned off. &f/penable ${args[0]}&e turns it back on.`)
    }
  })

  commands.register({
    name: 'penable',
    category: 'server',
    rank: 'Owner',
    usage: '/penable <plugin>',
    description: 'Turns a plugin back on',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      let p
      try { p = plugins.enable(args[0]) } catch (err) { throw new CommandError(err.message) }
      player.message(`&aPlugin ${p.name} turned on.`)
    }
  })

  const PLUGIN_SUBS = { list: 'plugins', load: 'pload', unload: 'punload', reload: 'preload', enable: 'penable', disable: 'pdisable', create: 'pcreate', install: 'pinstall', uninstall: 'puninstall' }
  commands.register({
    name: 'plugin',
    category: 'server',
    usage: `/plugin <${Object.keys(PLUGIN_SUBS).join('|')}> [name]`,
    description: 'Manages plugins (same as /plugins, /pload, /punload...)',
    async run (player, args, { usage }) {
      const target = PLUGIN_SUBS[(args[0] || 'list').toLowerCase()]
      if (!target) return usage()
      await commands.execute(player, `/${target} ${args.slice(1).join(' ')}`)
    }
  })

  commands.register({
    name: 'restart',
    category: 'server',
    rank: 'Owner',
    usage: '/restart [reason]',
    description: 'Saves everything and starts the server again',
    async run (player, args) {
      const reason = args.length ? args.join(' ') : 'Server is restarting'
      server.broadcast(`&e${reason}...`)
      await server.stop(reason)
      if (server.config.exitOnStop === false) return
      // under systemd, pm2 or a start script loop the supervisor starts us again
      if (process.env.MCSCRIPT_SUPERVISED) process.exit(0)
      const { spawn } = require('child_process')
      spawn(process.argv[0], process.argv.slice(1), { stdio: 'inherit', cwd: process.cwd(), detached: true }).unref()
      process.exit(0)
    }
  })

  commands.register({
    name: 'stop',
    aliases: ['shutdown'],
    category: 'server',
    rank: 'Owner',
    usage: '/stop [reason]',
    description: 'Saves everything and stops the server',
    async run (player, args) {
      const reason = args.length ? args.join(' ') : 'Server is shutting down'
      await server.stop(reason)
      if (server.config.exitOnStop !== false) process.exit(0)
    }
  })
}

module.exports.CATEGORIES = CATEGORIES
