'use strict'

// Block physics, like classic servers:
//   level 1: sand and gravel fall, water and lava flow, sponges soak up water, water + lava = stone
//   level 2: also grass dies in the dark and spreads to lit dirt, TNT next to fire or lava explodes
// Each level has its own setting (/physics), saved inside the level file.

const AIR = 0
const STONE = 1
const GRASS = 2
const DIRT = 3
const WATER = 8
const STILL_WATER = 9
const LAVA = 10
const STILL_LAVA = 11
const SAND = 12
const GRAVEL = 13
const SPONGE = 19
const TNT = 46
const FIRE = 54

const isWater = b => b === WATER || b === STILL_WATER
const isLava = b => b === LAVA || b === STILL_LAVA
const isLiquid = b => isWater(b) || isLava(b)

// Delays in ticks (1 tick = 100 ms)
const DELAY = { [WATER]: 2, [LAVA]: 8, [SAND]: 1, [GRAVEL]: 1, [SPONGE]: 1, [TNT]: 10, [GRASS]: 60, [DIRT]: 60 }

module.exports = {
  name: 'physics',
  version: '1.0.0',
  description: 'Falling sand, flowing water and lava, sponges, grass and TNT',
  author: 'MCScript',

  defaultConfig: {
    defaultLevel: 1,
    maxUpdatesPerTick: 20000,
    tntRadius: 3
  },

  load (ctx) {
    const { server, config, CommandError } = ctx
    const states = new Map() // level name -> { queue: Map(index -> due tick) }
    const primed = new Set() // TNT set off by an explosion
    let tick = 0

    const modeOf = level => level.meta.physics ?? config.defaultLevel
    const stateOf = level => {
      let st = states.get(level.name)
      if (!st) states.set(level.name, (st = { queue: new Map() }))
      return st
    }

    const schedule = (level, index, delay = 1) => {
      if (!modeOf(level)) return
      const q = stateOf(level).queue
      const due = tick + delay
      const cur = q.get(index)
      if (cur === undefined || cur > due) q.set(index, due)
    }

    const scheduleAround = (level, x, y, z) => {
      const dirs = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
      for (const [dx, dy, dz] of dirs) {
        const nx = x + dx; const ny = y + dy; const nz = z + dz
        if (!level.inBounds(nx, ny, nz)) continue
        const b = level.getBlock(nx, ny, nz)
        if (DELAY[b] !== undefined) schedule(level, level.index(nx, ny, nz), DELAY[b])
      }
    }

    // Finds blocks that need physics when a level loads or physics is turned on
    const scan = (level) => {
      if (!modeOf(level)) return
      const st = stateOf(level)
      for (let i = 0; i < level.volume; i++) {
        const b = level.blocks[i]
        if (b === WATER || b === LAVA || b === SAND || b === GRAVEL) {
          const { x, y, z } = level.unpack(i)
          if (b === SAND || b === GRAVEL) { if (y > 0 && fallsInto(level.getBlock(x, y - 1, z))) st.queue.set(i, tick + 1) } else st.queue.set(i, tick + DELAY[b])
        }
      }
    }

    const fallsInto = b => b === AIR || isLiquid(b)

    const nearSponge = (level, x, y, z) => {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) if (level.getBlock(x + dx, y + dy, z + dz) === SPONGE) return true
        }
      }
      return false
    }

    // Explodes at a position; returns the changes made (also used by the TNT Wars minigame)
    const explode = (level, x, y, z, radius = config.tntRadius) => {
      const changes = []
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
            if (d > radius + 0.5 || (d > radius - 1 && Math.random() < 0.4)) continue
            const nx = x + dx; const ny = y + dy; const nz = z + dz
            if (!level.inBounds(nx, ny, nz)) continue
            const b = level.getBlock(nx, ny, nz)
            if (b === 7 || b === 49 || b === AIR) continue // bedrock and obsidian resist
            if (b === TNT && (dx || dy || dz)) {
              const i = level.index(nx, ny, nz)
              primed.add(level.name + ':' + i)
              schedule(level, i, 2 + Math.floor(Math.random() * 4))
              continue
            }
            changes.push([nx, ny, nz, AIR])
          }
        }
      }
      level.setBlocks(changes)
      for (const [cx, cy, cz] of changes) scheduleAround(level, cx, cy, cz)
      server.events.fire('explosion', { level, x, y, z, radius })
      return changes
    }

    const process = (level, index, changes, pending) => {
      const b = pending.has(index) ? pending.get(index) : level.getAt(index)
      const { x, y, z } = level.unpack(index)
      const mode = modeOf(level)
      const get = (nx, ny, nz) => {
        if (!level.inBounds(nx, ny, nz)) return STONE
        const i = level.index(nx, ny, nz)
        return pending.has(i) ? pending.get(i) : level.getAt(i)
      }
      const set = (nx, ny, nz, block) => {
        const i = level.index(nx, ny, nz)
        pending.set(i, block)
        changes.push([nx, ny, nz, block])
      }

      switch (b) {
        case SAND:
        case GRAVEL: {
          let ny = y
          while (ny > 0 && fallsInto(get(x, ny - 1, z))) ny--
          if (ny !== y) {
            set(x, y, z, AIR)
            set(x, ny, z, b)
            scheduleAround(level, x, y, z)
          }
          break
        }
        case WATER:
        case LAVA: {
          const other = b === WATER ? isLava : isWater
          for (const [dx, dy, dz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
            const nx = x + dx; const ny = y + dy; const nz = z + dz
            if (!level.inBounds(nx, ny, nz)) continue
            const t = get(nx, ny, nz)
            if (t === AIR) {
              if (b === WATER && nearSponge(level, nx, ny, nz)) continue
              set(nx, ny, nz, b)
              schedule(level, level.index(nx, ny, nz), DELAY[b])
            } else if (other(t)) {
              set(nx, ny, nz, STONE)
            } else if (b === LAVA && t === TNT && mode >= 2) {
              schedule(level, level.index(nx, ny, nz), DELAY[TNT])
            }
          }
          break
        }
        case SPONGE: {
          for (let dy = -2; dy <= 2; dy++) {
            for (let dz = -2; dz <= 2; dz++) {
              for (let dx = -2; dx <= 2; dx++) {
                if (isWater(get(x + dx, y + dy, z + dz))) set(x + dx, y + dy, z + dz, AIR)
              }
            }
          }
          break
        }
        case TNT: {
          if (mode < 2) break
          const lit = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => {
            const n = get(x + dx, y + dy, z + dz)
            return n === FIRE || isLava(n)
          })
          // TNT hit by another explosion goes off too (chain reaction)
          if (primed.delete(level.name + ':' + index) || lit) explode(level, x, y, z)
          break
        }
        case GRASS:
          if (mode >= 2 && !transparent(get(x, y + 1, z))) set(x, y, z, DIRT)
          break
        case DIRT:
          if (mode >= 2 && get(x, y + 1, z) === AIR && Math.random() < 0.5) set(x, y, z, GRASS)
          break
      }
    }

    const transparent = b => [AIR, 6, 18, 20, 37, 38, 39, 40, 44, 50, 51, 53, 54].includes(b)

    ctx.setInterval(() => {
      tick++
      for (const [name, st] of states) {
        const level = server.levels.get(name)
        if (!level) { states.delete(name); continue }
        if (!modeOf(level) || !st.queue.size) continue
        const due = []
        for (const [index, at] of st.queue) {
          if (at <= tick) due.push(index)
          if (due.length >= config.maxUpdatesPerTick) break
        }
        if (!due.length) continue
        for (const i of due) st.queue.delete(i)
        const changes = []
        const pending = new Map()
        for (const i of due) process(level, i, changes, pending)
        if (changes.length) {
          // keep only the last change for each position
          const last = new Map()
          for (const c of changes) last.set(level.index(c[0], c[1], c[2]), c)
          level.setBlocks([...last.values()])
        }
      }
    }, 100)

    ctx.on('blockChange', (ev) => {
      if (ev.cancelled) return
      // run after the block is actually set
      setImmediate(() => scheduleAround(ev.level, ev.x, ev.y, ev.z))
    }, { priority: 'monitor' })

    ctx.on('drawOperation', (ev) => {
      if (ev.cancelled) return
      const level = ev.level
      setImmediate(() => { for (const [x, y, z] of ev.changes.slice(0, 50000)) scheduleAround(level, x, y, z) })
    }, { priority: 'monitor' })

    ctx.on('levelLoad', ({ level }) => scan(level))
    ctx.on('levelUnload', ({ level }) => states.delete(level.name), { priority: 'monitor' })
    for (const level of server.levels.loaded.values()) scan(level)

    ctx.command({
      name: 'physics',
      aliases: ['phys'],
      category: 'world',
      rank: 'Operator',
      usage: '/physics [0|1|2] [level]',
      description: 'Shows or changes block physics: 0 = off, 1 = normal, 2 = advanced (grass, TNT)',
      run (player, args) {
        const level = args[1] ? server.levels.get(args[1]) : player.level
        if (!level) throw new CommandError('That level is not loaded.')
        if (args[0] === undefined) {
          const st = states.get(level.name)
          return player.message(`&ePhysics in ${level.name}: &f${modeOf(level)}&e (${st ? st.queue.size : 0} pending updates)`)
        }
        const mode = Number(args[0])
        if (![0, 1, 2].includes(mode)) throw new CommandError('Physics level must be 0, 1 or 2.')
        level.meta.physics = mode
        level.dirty = true
        if (mode === 0) states.delete(level.name)
        else scan(level)
        server.broadcast(`&ePhysics in ${level.name} set to &f${mode}&e.`, p => p.level === level)
      }
    })

    module.exports.api = {
      explode: (level, x, y, z, radius) => explode(level, x, y, z, radius),
      schedule: (level, x, y, z) => scheduleAround(level, x, y, z),
      modeOf
    }
  }
}
