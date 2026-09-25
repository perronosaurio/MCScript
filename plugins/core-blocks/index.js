'use strict'

// Custom blocks (CPE BlockDefinitions): /gb for global blocks, /lb for blocks of a single level.

const PRESETS = {
  barrier: { name: 'Barrier', collide: 2, draw: 4, textures: all(49), transmitsLight: true, sound: 0, fallback: 20 },
  lamp: { name: 'Lamp', fullBright: true, textures: all(24), sound: 6, fallback: 41 },
  pane: { name: 'Glass pane', draw: 1, textures: all(49), transmitsLight: true, sound: 6, min: [0, 0, 7], max: [16, 16, 9], fallback: 20 },
  stoneslab: { name: 'Stone slab', textures: { ...all(1) }, min: [0, 0, 0], max: [16, 8, 16], fallback: 44 },
  carpet: { name: 'White carpet', textures: all(79), sound: 7, min: [0, 0, 0], max: [16, 1, 16], collide: 0, fallback: 36 },
  plank: { name: 'Wood slab', textures: all(4), sound: 1, max: [16, 8, 16], fallback: 44 },
  ladder: { name: 'Ladder', textures: all(4), collide: 7, draw: 1, min: [2, 0, 2], max: [14, 16, 14], sound: 1, fallback: 5 },
  fence: { name: 'Fence post', textures: all(4), min: [6, 0, 6], max: [10, 16, 10], sound: 1, fallback: 5 },
  jelly: { name: 'Slime', textures: all(25), draw: 3, speed: 0.5, sound: 7, fallback: 25 },
  speed: { name: 'Speed pad', textures: all(83), speed: 3, max: [16, 2, 16], collide: 0, sound: 5, fallback: 29 }
}

function all (tex) { return { top: tex, bottom: tex, left: tex, right: tex, front: tex, back: tex } }

module.exports = {
  name: 'core-blocks',
  version: '2.0.0',
  description: 'Create and edit custom blocks for everyone (/gb) or for one level (/lb)',
  author: 'MCScript',

  load (ctx) {
    const { server, Blocks, CommandError } = ctx

    const scopeFor = (global, player) => global
      ? {
          label: 'global',
          get: id => server.blockDefs[id] || null,
          set: def => server.setGlobalBlock(def),
          remove: id => server.removeGlobalBlock(id),
          all: () => Object.values(server.blockDefs)
        }
      : {
          label: `level ${player.level.name}`,
          get: id => player.level.blockDefs[id] || null,
          set: def => server.setLevelBlock(player.level, def),
          remove: id => server.removeLevelBlock(player.level, id),
          all: () => Object.values(player.level.blockDefs)
        }

    const idArg = (value) => {
      const id = Number(value)
      if (!Number.isInteger(id) || id < 1 || id > 255) throw new CommandError('Block id must be a number between 1 and 255 (66-255 for new blocks).')
      return id
    }
    const bool = v => ['1', 'true', 'yes', 'on', 'y'].includes(String(v).toLowerCase())
    const enumArg = (table, value, label) => {
      const v = String(value).toLowerCase().replace(/[\s_-]/g, '')
      if (/^\d+$/.test(v)) return Number(v)
      if (table[v] === undefined) throw new CommandError(`${label}: ${Object.keys(table).join(', ')}`)
      return table[v]
    }
    const coords = (args) => {
      const n = args.map(Number)
      if (n.length !== 3 || !n.every(v => Number.isInteger(v) && v >= 0 && v <= 16)) throw new CommandError('Give three numbers between 0 and 16.')
      return n
    }

    // Applies "prop value" to a definition
    function edit (def, prop, values, player) {
      const value = values.join(' ')
      switch (prop) {
        case 'name': def.name = value.slice(0, 64); break
        case 'collide': case 'collision': case 'solidity': def.collide = enumArg(Blocks.COLLIDE, value, 'Collide types'); break
        case 'speed': {
          const s = Number(value)
          if (!(s >= 0.25 && s <= 3.96)) throw new CommandError('Speed must be between 0.25 and 3.96.')
          def.speed = s
          break
        }
        case 'toptex': def.textures.top = tex(value); break
        case 'bottomtex': def.textures.bottom = tex(value); break
        case 'sidetex': def.textures.left = def.textures.right = def.textures.front = def.textures.back = tex(value); break
        case 'lefttex': def.textures.left = tex(value); break
        case 'righttex': def.textures.right = tex(value); break
        case 'fronttex': def.textures.front = tex(value); break
        case 'backtex': def.textures.back = tex(value); break
        case 'alltex': case 'texture': { const t = tex(value); def.textures = all(t); break }
        case 'blockslight': def.transmitsLight = !bool(value); break
        case 'sound': case 'walksound': def.sound = enumArg(Blocks.SOUNDS, value, 'Sounds'); break
        case 'fullbright': case 'glow': def.fullBright = bool(value); break
        case 'shape': case 'height':
          if (value === 'sprite') { def.sprite = true } else {
            const h = Number(value)
            if (!(h >= 1 && h <= 16)) throw new CommandError('Shape: sprite or a height between 1 and 16.')
            def.sprite = false
            def.min = [0, 0, 0]
            def.max = [16, h, 16]
          }
          break
        case 'min': def.min = coords(values); def.sprite = false; break
        case 'max': def.max = coords(values); def.sprite = false; break
        case 'draw': def.draw = enumArg(Blocks.DRAW, value, 'Draw modes'); break
        case 'fogdensity': case 'fog': def.fogDensity = Math.max(0, Math.min(255, Number(value) || 0)); break
        case 'fogcolor': {
          const hex = value.replace('#', '')
          if (!/^[0-9a-f]{6}$/i.test(hex)) throw new CommandError('Fog color must be hex like 336699.')
          const n = parseInt(hex, 16)
          def.fogColor = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
          break
        }
        case 'fallback': {
          const b = player.level.parseBlock(value)
          if (b === null || b > Blocks.MAX_CPE) throw new CommandError('Fallback must be a standard block (0-65).')
          def.fallback = b
          break
        }
        default:
          throw new CommandError('Properties: name, collide, speed, alltex, toptex, sidetex, bottomtex, left/right/front/backtex, blockslight, sound, fullbright, shape, min, max, draw, fogdensity, fogcolor, fallback')
      }
    }

    function tex (value) {
      const t = Number(value)
      if (!Number.isInteger(t) || t < 0 || t > 255) throw new CommandError('Texture ids go from 0 to 255 (position in terrain.png, left to right, top to bottom).')
      return t
    }

    function describe (player, def) {
      const d = Blocks.normalize(def)
      const name = k => Object.keys(Blocks[k]).find(n => Blocks[k][n] === d[k === 'COLLIDE' ? 'collide' : k === 'DRAW' ? 'draw' : 'sound'])
      player.message(`&eBlock &f${d.id}&e: &f${d.name}`)
      player.message(`&7  collide ${name('COLLIDE')}, speed ${d.speed}, draw ${name('DRAW')}, sound ${name('SOUNDS')}, ${d.fullBright ? 'glows' : 'no glow'}, ${d.transmitsLight ? 'lets light through' : 'blocks light'}`)
      player.message(`&7  textures top ${d.textures.top}, sides ${d.textures.left}/${d.textures.right}/${d.textures.front}/${d.textures.back}, bottom ${d.textures.bottom}`)
      player.message(`&7  ${d.sprite ? 'sprite' : `box min ${d.min.join(',')} max ${d.max.join(',')}`}, fallback ${player.level.blockName(d.fallback)}`)
    }

    function handler (global) {
      return (player, args, { usage }) => {
        const scope = scopeFor(global, player)
        const sub = (args.shift() || '').toLowerCase()

        if (sub === 'list') {
          const defs = scope.all().sort((a, b) => a.id - b.id)
          if (!defs.length) return player.message(`&eNo ${scope.label} custom blocks.`)
          player.message(`&eCustom blocks (${scope.label}): ` + defs.map(d => `&f${d.id}&7:${d.name}`).join('&7, '))
          return
        }
        if (sub === 'presets') {
          return player.message(`&ePresets: &f${Object.keys(PRESETS).join(', ')}&e. Use &f${global ? '/gb' : '/lb'} preset <id> <name>`)
        }
        if (!sub || !args[0]) return usage()

        if (sub === 'copy') {
          const src = idArg(args[0]); const dest = idArg(args[1])
          const base = player.level.getBlockDef(src) || Blocks.coreDefinition(src)
          const def = scope.set({ ...JSON.parse(JSON.stringify(base)), id: dest })
          return player.message(`&aCopied block ${src} to ${dest} (${def.name}).`)
        }

        const id = idArg(args.shift())
        const existing = scope.get(id)

        switch (sub) {
          case 'add':
          case 'create': {
            if (existing) throw new CommandError(`Block ${id} already exists. Use edit or remove it first.`)
            if (id <= Blocks.MAX_CPE) player.message(`&eNote: ${id} is a standard block; your definition will replace how it looks.`)
            const name = args.join(' ') || `Custom ${id}`
            const def = scope.set({ ...Blocks.coreDefinition(1), id, name, fallback: 1 })
            player.message(`&aCreated ${scope.label} block ${id} (${def.name}). Customize it with &f${global ? '/gb' : '/lb'} edit ${id} <property> <value>`)
            break
          }
          case 'preset': {
            const preset = PRESETS[(args[0] || '').toLowerCase()]
            if (!preset) throw new CommandError(`Presets: ${Object.keys(PRESETS).join(', ')}`)
            const def = scope.set({ ...Blocks.coreDefinition(1), ...JSON.parse(JSON.stringify(preset)), id })
            player.message(`&aCreated ${def.name} as block ${id}.`)
            break
          }
          case 'edit':
          case 'set': {
            if (!existing) throw new CommandError(`There is no ${scope.label} block ${id}.`)
            if (!args[0]) return usage()
            const def = Blocks.normalize(JSON.parse(JSON.stringify(existing)))
            edit(def, args.shift().toLowerCase(), args, player)
            scope.set(def)
            player.message(`&aUpdated block ${id}.`)
            break
          }
          case 'remove':
          case 'delete': {
            if (!existing) throw new CommandError(`There is no ${scope.label} block ${id}.`)
            scope.remove(id)
            player.message(`&aRemoved block ${id}.`)
            break
          }
          case 'info': {
            const def = existing || player.level.getBlockDef(id)
            if (!def) throw new CommandError(`Block ${id} is not a custom block.`)
            describe(player, def)
            break
          }
          default:
            return usage()
        }
      }
    }

    const help = [
      'add <id> [name] - create (copy of stone); preset <id> <name>; copy <from> <to>',
      'edit <id> <property> <value> - properties: name, collide, speed, alltex, toptex, sidetex, bottomtex, blockslight, sound, fullbright, shape, min, max, draw, fogdensity, fogcolor, fallback',
      'remove <id>, info <id>, list, presets'
    ]

    ctx.command({
      name: 'gb',
      aliases: ['globalblock'],
      category: 'blocks',
      rank: 'Admin',
      usage: '/gb <add|preset|copy|edit|remove|info|list|presets> ...',
      description: 'Manages custom blocks available in every level',
      help,
      run: handler(true)
    })

    ctx.command({
      name: 'lb',
      aliases: ['levelblock'],
      category: 'blocks',
      rank: 'Operator',
      usage: '/lb <add|preset|copy|edit|remove|info|list|presets> ...',
      description: 'Manages custom blocks of your current level',
      help,
      inGame: true,
      run: handler(false)
    })
  }
}
