'use strict'

// Multiple levels: create, load, visit, import, backup and customize environment (colors, texture pack, weather).

const PRESETS = {
  normal: { skyColor: null, cloudColor: null, fogColor: null, shadowColor: null, sunColor: null, skyboxColor: null },
  sunny: { skyColor: '70a3f7', cloudColor: 'ffffff', fogColor: 'ffffff', shadowColor: '9b9b9b', sunColor: 'ffffff' },
  sunset: { skyColor: 'ffa322', cloudColor: '9a6551', fogColor: 'ffa322', shadowColor: '7f6c60', sunColor: 'fffaf0' },
  night: { skyColor: '0b1026', cloudColor: '2a2a44', fogColor: '0b1026', shadowColor: '3a3a4a', sunColor: '7a7a8a' },
  midnight: { skyColor: '000000', cloudColor: '000000', fogColor: '000000', shadowColor: '2f2f2f', sunColor: '4f4f4f' },
  cartoon: { skyColor: '00b9ff', cloudColor: 'ffffff', fogColor: '70d1ff', shadowColor: 'a0a0a0', sunColor: 'ffffff' },
  noir: { skyColor: '000000', cloudColor: '1f1f1f', fogColor: '000000', shadowColor: '1f1f1f', sunColor: '737373' },
  watery: { skyColor: '5f9ea0', cloudColor: '5f9ea0', fogColor: '5f9ea0', shadowColor: '3b6c6e', sunColor: 'c4f1f2' },
  hell: { skyColor: '4a0000', cloudColor: '6e1a00', fogColor: '8b1a00', shadowColor: '5a2a2a', sunColor: 'ff9a6a' }
}

const COLOR_PROPS = {
  sky: 'skyColor',
  cloud: 'cloudColor',
  clouds: 'cloudColor',
  fog: 'fogColor',
  shadow: 'shadowColor',
  ambient: 'shadowColor',
  sun: 'sunColor',
  sunlight: 'sunColor',
  skybox: 'skyboxColor'
}

const NUMBER_PROPS = {
  edgelevel: ['edgeHeight', true],
  waterlevel: ['edgeHeight', true],
  level: ['edgeHeight', true],
  cloudsheight: ['cloudsHeight', true],
  cloudheight: ['cloudsHeight', true],
  maxfog: ['maxFog', true],
  cloudspeed: ['cloudsSpeed', false],
  cloudsspeed: ['cloudsSpeed', false],
  weatherspeed: ['weatherSpeed', false],
  weatherfade: ['weatherFade', false],
  sidesoffset: ['sidesOffset', true],
  skyboxhorspeed: ['skyboxHorSpeed', false],
  skyboxverspeed: ['skyboxVerSpeed', false]
}

const NAMED_COLORS = {
  red: 'ff0000',
  green: '00ff00',
  blue: '0000ff',
  white: 'ffffff',
  black: '000000',
  yellow: 'ffff00',
  orange: 'ffa500',
  purple: '800080',
  pink: 'ffc0cb',
  gray: '808080',
  grey: '808080',
  cyan: '00ffff',
  lime: '32cd32'
}

const WEATHER = { sun: 0, sunny: 0, clear: 0, rain: 1, raining: 1, snow: 2, snowing: 2 }

function parseHex (value) {
  value = String(value).toLowerCase().replace(/^#/, '')
  if (NAMED_COLORS[value]) return NAMED_COLORS[value]
  if (/^[0-9a-f]{3}$/.test(value)) return value.split('').map(c => c + c).join('')
  if (/^[0-9a-f]{6}$/.test(value)) return value
  return undefined
}

module.exports = {
  name: 'core-worlds',
  version: '2.0.0',
  description: 'Multiple levels, environment, texture packs, weather and backups',
  author: 'MCScript',

  defaultConfig: {
    maxVolume: 64 * 1024 * 1024,
    autoLoad: true,
    defaultSize: [128, 64, 128]
  },

  load (ctx) {
    const { server, config, CommandError } = ctx
    const levels = server.levels

    const levelArg = (player, name, { allowUnloaded = false } = {}) => {
      if (!name) return player.level
      const loaded = levels.get(name) || levels.get(levels.resolveName(name))
      if (loaded) return loaded
      const real = levels.resolveName(name)
      if (!real) {
        const matches = levels.listFiles().filter(f => f.toLowerCase().includes(name.toLowerCase()))
        if (matches.length === 1) return levelArg(player, matches[0], { allowUnloaded })
        throw new CommandError(matches.length ? `Several levels match: ${matches.slice(0, 10).join(', ')}` : `Level "${name}" does not exist.`)
      }
      if (!allowUnloaded) throw new CommandError(`Level "${real}" is not loaded. Use /load ${real}`)
      return levels.load(real)
    }

    const applyEnv = (level) => {
      level.dirty = true
      for (const p of level.players) if (p.spawned) p.sendEnv()
    }

    // ---------------------------------------------------------------- levels

    ctx.command({
      name: 'newlvl',
      aliases: ['newlevel', 'mapcreate'],
      category: 'world',
      rank: 'Admin',
      usage: '/newlvl <name> [width height length] [type] [seed]',
      description: `Creates a level. Types: ${Object.keys(server.generators).join(', ')}`,
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const name = args.shift()
        let [width, height, length] = config.defaultSize
        if (args.length >= 3 && args.slice(0, 3).every(a => /^\d+$/.test(a))) {
          [width, height, length] = args.splice(0, 3).map(Number)
        }
        const type = (args[0] || 'flat').toLowerCase()
        const seed = args[1] !== undefined ? parseInt(args[1], 10) || hashSeed(args[1]) : undefined
        for (const v of [width, height, length]) if (v < 16 || v > 8192) throw new CommandError('Each dimension must be between 16 and 8192 (more than 1023 needs an up to date client).')
        if (width * height * length > config.maxVolume) throw new CommandError(`Level too big (max ${config.maxVolume} blocks).`)
        player.message(`&eGenerating ${type} level &f${name}&e (${width}x${height}x${length})...`)
        const level = levels.create(name, { width, height, length, type, seed, creator: player.isConsole ? null : player.name })
        player.message(`&aCreated level ${level.name}. Use &f/goto ${level.name}&a to visit it.`)
      }
    })

    ctx.command({
      name: 'goto',
      aliases: ['g', 'j', 'join', 'gotolevel'],
      category: 'world',
      usage: '/goto <level>',
      description: 'Takes you to another level',
      inGame: true,
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const level = levelArg(player, args[0], { allowUnloaded: config.autoLoad })
        if (player.changeLevel(level)) player.message(`&eWelcome to &f${level.name}&e!`, 'status1')
      }
    })

    ctx.command({
      name: 'levels',
      aliases: ['worlds', 'maps', 'lvls'],
      category: 'world',
      usage: '/levels',
      description: 'Lists all levels',
      run (player) {
        const loaded = [...levels.loaded.values()]
        player.message(`&eLoaded (${loaded.length}): ` + loaded.map(l => {
          const n = l.players.length
          return `&f${l.name}${n ? `&7[${n}]` : ''}`
        }).join('&7, '))
        const unloaded = levels.listFiles().filter(f => !levels.get(f))
        if (unloaded.length) player.message(`&eOn disk (${unloaded.length}): &7${unloaded.join(', ')}`)
      }
    })

    ctx.command({
      name: 'load',
      aliases: ['loadlevel'],
      category: 'world',
      rank: 'Operator',
      usage: '/load <level>',
      description: 'Loads a level from disk',
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const level = levelArg(player, args[0], { allowUnloaded: true })
        player.message(`&aLevel ${level.name} is loaded.`)
      }
    })

    ctx.command({
      name: 'unload',
      aliases: ['unloadlevel'],
      category: 'world',
      rank: 'Operator',
      usage: '/unload <level>',
      description: 'Saves and unloads a level (players are sent to main)',
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const level = levelArg(player, args[0])
        if (!levels.unload(level.name)) throw new CommandError('The level could not be unloaded.')
        player.message(`&aUnloaded ${level.name}.`)
      }
    })

    ctx.command({
      name: 'save',
      category: 'world',
      rank: 'Operator',
      usage: '/save [level|all]',
      description: 'Saves a level (or all of them)',
      run (player, args) {
        if ((args[0] || '').toLowerCase() === 'all') {
          const n = levels.saveAll(false)
          return player.message(`&aSaved ${n} level${n === 1 ? '' : 's'}.`)
        }
        const level = levelArg(player, args[0])
        levels.save(level)
        player.message(`&aSaved ${level.name}.`)
      }
    })

    ctx.command({
      name: 'deletelvl',
      aliases: ['dellvl', 'deletelevel'],
      category: 'world',
      rank: 'Admin',
      usage: '/deletelvl <level> confirm',
      description: 'Deletes a level (it is moved to levels/deleted)',
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const real = levels.resolveName(args[0])
        if (!real) throw new CommandError(`Level "${args[0]}" does not exist.`)
        if ((args[1] || '').toLowerCase() !== 'confirm') {
          return player.message(`&eType &f/deletelvl ${real} confirm&e to delete ${real}.`)
        }
        levels.delete(real)
        player.message(`&aDeleted ${real}. A copy was kept in levels/deleted.`)
      }
    })

    ctx.command({
      name: 'import',
      aliases: ['importlvl'],
      category: 'world',
      rank: 'Admin',
      usage: '/import <file.lvl|file.cw|file.dat> [new name]',
      description: 'Imports a map file placed in the levels folder (MCGalaxy .lvl supported)',
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const level = levels.import(args[0], args[1])
        player.message(`&aImported ${level.name} (${level.width}x${level.height}x${level.length}).`)
        for (const w of level.importWarnings || []) player.message(`&e${w}`)
      }
    })

    ctx.command({
      name: 'mapinfo',
      aliases: ['levelinfo', 'mi'],
      category: 'world',
      usage: '/mapinfo [level]',
      description: 'Shows information about a level',
      run (player, args) {
        const level = levelArg(player, args[0])
        const rankName = r => { const x = server.ranks.get(r ?? server.ranks.default.name); return x ? x.color + x.name : String(r) }
        player.message(`&eLevel &f${level.name}&e: ${level.width}x${level.height}x${level.length} (${level.volume.toLocaleString()} blocks)`)
        player.message(`&7  Created ${new Date(level.createdAt).toISOString().slice(0, 10)}${level.createdBy ? ' by ' + level.createdBy : ''}${level.generator ? ', generator ' + level.generator : ''}`)
        player.message(`&7  Build: ${rankName(level.buildRank)}&7+, visit: ${rankName(level.visitRank)}&7+, players here: &f${level.players.length}`)
        if (level.owners.length) player.message(`&7  Owners: &f${level.owners.join(', ')}`)
        player.message(`&7  MOTD: &f${level.motd}`)
        const e = level.env
        player.message(`&7  Texture: &f${e.texture || 'default'}&7, weather: &f${['sun', 'rain', 'snow'][e.weather]}`)
        player.message(`&7  Custom blocks: &f${Object.keys(level.blockDefs).length}&7 level, &f${Object.keys(server.blockDefs).length}&7 global`)
        const backups = levels.listBackups(level.name)
        if (backups.length) player.message(`&7  Backups: &f${backups.join(', ')}`)
      }
    })

    ctx.command({
      name: 'map',
      aliases: ['mapset', 'levelset'],
      category: 'world',
      rank: 'Operator',
      usage: '/map <motd|buildrank|visitrank|owner> <value>',
      description: 'Changes settings of your current level',
      help: ['motd: text shown while loading; can contain hack flags like -hax +fly -noclip. "ignore" = server motd', 'buildrank / visitrank: minimum rank to build in / go to this level', 'owner add|remove <player>: owners can always build here'],
      inGame: true,
      run (player, args, { usage }) {
        const level = player.level
        const option = (args[0] || '').toLowerCase()
        const value = args.slice(1).join(' ')
        if (!value) return usage()
        if (option === 'motd') {
          level.motd = value.slice(0, 64)
          for (const p of level.players) if (p.supports('InstantMOTD')) p._sendIdentification(level)
          player.message(`&aMOTD of ${level.name} set to: &f${level.motd}`)
        } else if (option === 'buildrank' || option === 'perbuild') {
          const rank = server.ranks.get(value)
          if (!rank) throw new CommandError('Unknown rank.')
          level.buildRank = rank.name
          for (const p of level.players) p.sendBlockPermissions()
          player.message(`&a${rank.color}${rank.name}&a+ can now build in ${level.name}.`)
        } else if (option === 'owner' || option === 'owners') {
          const [action, who] = value.toLowerCase().split(/\s+/)
          if (!['add', 'remove'].includes(action) || !who) throw new CommandError('Usage: /map owner <add|remove> <player>')
          if (action === 'add' && !level.owners.includes(who)) level.owners.push(who)
          if (action === 'remove') level.owners = level.owners.filter(o => o !== who)
          for (const p of level.players) p.sendBlockPermissions()
          player.message(`&aOwners of ${level.name}: &f${level.owners.join(', ') || 'none'}`)
        } else if (option === 'visitrank' || option === 'pervisit') {
          const rank = server.ranks.get(value)
          if (!rank) throw new CommandError('Unknown rank.')
          level.visitRank = rank.name
          player.message(`&a${rank.color}${rank.name}&a+ can now visit ${level.name}.`)
        } else {
          return usage()
        }
        level.dirty = true
      }
    })

    ctx.command({
      name: 'setspawn',
      category: 'world',
      rank: 'Operator',
      usage: '/setspawn',
      description: 'Sets the spawn of the level to your position',
      inGame: true,
      run (player) {
        const p = player.feetPos
        player.level.spawn = { x: p.x, y: p.y, z: p.z, yaw: player.yaw, pitch: player.pitch }
        player.level.dirty = true
        player.message('&aSpawn set to your position.')
      }
    })

    // ---------------------------------------------------------------- backups

    ctx.command({
      name: 'backup',
      category: 'world',
      rank: 'Operator',
      usage: '/backup [list]',
      description: 'Creates a backup of your level now, or lists backups',
      inGame: true,
      run (player, args) {
        const level = player.level
        if ((args[0] || '').toLowerCase() === 'list') {
          const list = levels.listBackups(level.name)
          return player.message(list.length ? `&eBackups of ${level.name}: &f${list.join(', ')}` : '&eNo backups yet.')
        }
        const n = levels.backup(level)
        player.message(`&aCreated backup ${n} of ${level.name}.`)
      }
    })

    ctx.command({
      name: 'restore',
      category: 'world',
      rank: 'Admin',
      usage: '/restore <backup number>',
      description: 'Restores your level from a backup',
      inGame: true,
      run (player, args, { usage }) {
        if (!/^\d+$/.test(args[0] || '')) return usage()
        levels.restore(player.level, Number(args[0]))
        server.broadcast(`&e${player.level.name} was restored to backup ${args[0]}.`, p => p.level === player.level)
      }
    })

    // ---------------------------------------------------------------- environment

    ctx.command({
      name: 'env',
      aliases: ['environment'],
      category: 'world',
      rank: 'Operator',
      usage: '/env <property> <value|reset>',
      description: 'Changes the environment of your level',
      help: [
        'Colors (hex like ff8800 or names): sky, cloud, fog, shadow, sun, skybox',
        'Blocks: side, edge. Numbers: edgelevel, cloudsheight, maxfog, cloudspeed, weatherspeed, weatherfade, sidesoffset',
        'Other: weather <sun|rain|snow>, expfog <on|off>, lighting <classic|fancy|reset>, preset <' + Object.keys(PRESETS).join('|') + '>'
      ],
      inGame: true,
      run (player, args, { usage }) {
        const level = player.level
        const prop = (args[0] || '').toLowerCase()
        const value = (args[1] || '').toLowerCase()
        if (!prop) {
          const e = level.env
          player.message(`&eEnvironment of ${level.name}:`)
          player.message(`&7  Colors: sky &f${e.skyColor || 'default'}&7, cloud &f${e.cloudColor || 'default'}&7, fog &f${e.fogColor || 'default'}&7, shadow &f${e.shadowColor || 'default'}&7, sun &f${e.sunColor || 'default'}`)
          player.message(`&7  Side &f${level.blockName(e.sideBlock)}&7, edge &f${level.blockName(e.edgeBlock)}&7, edge level &f${e.edgeHeight ?? 'default'}&7, clouds &f${e.cloudsHeight ?? 'default'}`)
          return player.message('&eUse &f/help env&e to see what you can change.')
        }
        if (!value) return usage()
        const reset = value === 'reset' || value === 'default' || value === 'normal'
        const env = level.env

        if (prop === 'preset') {
          const preset = PRESETS[value]
          if (!preset) throw new CommandError(`Presets: ${Object.keys(PRESETS).join(', ')}`)
          Object.assign(env, PRESETS.normal, preset)
        } else if (prop === 'reset' || prop === 'all') {
          Object.assign(env, server.levels.defaultEnv(), { texture: env.texture })
        } else if (COLOR_PROPS[prop]) {
          const hex = reset ? null : parseHex(value)
          if (hex === undefined) throw new CommandError('Use a hex color like ff8800, a short one like f80, or a name like red.')
          env[COLOR_PROPS[prop]] = hex
        } else if (prop === 'side' || prop === 'sideblock' || prop === 'edge' || prop === 'edgeblock' || prop === 'water' || prop === 'bedrock') {
          const key = (prop.startsWith('edge') || prop === 'water') ? 'edgeBlock' : 'sideBlock'
          const block = reset ? (key === 'edgeBlock' ? 8 : 7) : level.parseBlock(value)
          if (block === null) throw new CommandError('Unknown block.')
          env[key] = block
        } else if (NUMBER_PROPS[prop]) {
          const [key, integer] = NUMBER_PROPS[prop]
          const defaults = server.levels.defaultEnv()
          if (reset) env[key] = defaults[key]
          else {
            const n = Number(value)
            if (!Number.isFinite(n)) throw new CommandError('That is not a number.')
            env[key] = integer ? Math.round(n) : n
          }
        } else if (prop === 'weather') {
          if (WEATHER[value] === undefined && !reset) throw new CommandError('Weather: sun, rain or snow.')
          env.weather = reset ? 0 : WEATHER[value]
        } else if (prop === 'expfog') {
          env.expFog = value === 'on' || value === 'true' || value === '1'
        } else if (prop === 'lighting') {
          const modes = { classic: 1, fancy: 2 }
          if (!reset && modes[value] === undefined) throw new CommandError('Lighting: classic, fancy or reset.')
          env.lighting = reset ? null : modes[value]
        } else {
          return usage()
        }
        applyEnv(level)
        player.message(`&aEnvironment updated (${prop}${reset ? ' reset' : ' = ' + value}).`)
      }
    })

    ctx.command({
      name: 'weather',
      category: 'world',
      rank: 'Operator',
      usage: '/weather <sun|rain|snow>',
      description: 'Changes the weather of your level',
      inGame: true,
      run (player, args, { usage }) {
        const w = WEATHER[(args[0] || '').toLowerCase()]
        if (w === undefined) return usage()
        player.level.env.weather = w
        applyEnv(player.level)
        server.broadcast(`&eThe weather in ${player.level.name} is now &f${['sunny', 'rainy', 'snowy'][w]}&e.`, p => p.level === player.level)
      }
    })

    ctx.command({
      name: 'texture',
      aliases: ['tex', 'texturepack'],
      category: 'world',
      rank: 'Operator',
      usage: '/texture <url|reset> [global]',
      description: 'Sets the texture pack (.zip) or terrain (.png) of your level, or of all levels with "global"',
      inGame: true,
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const reset = args[0].toLowerCase() === 'reset'
        const url = reset ? '' : args[0]
        if (!reset) {
          if (!/^https?:\/\//i.test(url)) throw new CommandError('The URL must start with http:// or https://')
          if (!/\.(zip|png)(\?.*)?$/i.test(url)) player.message('&eWarning: texture URLs normally end in .zip (texture pack) or .png (terrain).')
          if (url.length > 64) throw new CommandError('The URL is too long (max 64 characters). Use a URL shortener or a shorter host.')
        }
        if ((args[1] || '').toLowerCase() === 'global') {
          server.config.defaultTexture = url
          server.saveConfig()
          for (const p of server.online) p.sendEnv()
          player.message(`&aDefault texture pack ${reset ? 'reset' : 'set'}.`)
        } else {
          player.level.env.texture = url
          applyEnv(player.level)
          player.message(`&aTexture pack of ${player.level.name} ${reset ? 'reset' : 'set'}.`)
        }
      }
    })
  }
}

function hashSeed (str) {
  let h = 2166136261
  for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}
