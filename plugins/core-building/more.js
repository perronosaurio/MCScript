'use strict'

// More drawing tools from MCGalaxy: /hollow /outline /pyramid /tree /torus /spheroid /mirror /spin /mark
// /drill /rainbow /maze /center /calculate /bind /mode

const RAINBOW = [21, 22, 23, 24, 28, 29, 31]

module.exports = function more (ctx, h) {
  const { server, CommandError } = ctx
  const { select, blockArg, checkVolume, box, apply, clipboards, key } = h

  const eachIn = function * (b) {
    for (let y = b.y1; y <= b.y2; y++) for (let z = b.z1; z <= b.z2; z++) for (let x = b.x1; x <= b.x2; x++) yield [x, y, z]
  }
  const volumeOf = b => (b.x2 - b.x1 + 1) * (b.y2 - b.y1 + 1) * (b.z2 - b.z1 + 1)
  const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]

  ctx.command({
    name: 'hollow',
    category: 'building',
    rank: 'AdvBuilder',
    usage: '/hollow [only block]',
    description: 'Removes the blocks inside a selection that don\'t touch air',
    inGame: true,
    async run (player, args) {
      const level = player.level
      const only = args[0] !== undefined ? level.parseBlock(args[0]) : null
      if (args[0] !== undefined && only === null) throw new CommandError('Unknown block.')
      const marks = await select(player, 2, 'Hollow')
      if (!marks) return
      const b = box(marks[0], marks[1])
      checkVolume(player, volumeOf(b))
      const changes = []
      for (const [x, y, z] of eachIn(b)) {
        const block = level.getBlock(x, y, z)
        if (block === 0 || (only !== null && block !== only)) continue
        const enclosed = NEIGHBORS.every(([dx, dy, dz]) => level.inBounds(x + dx, y + dy, z + dz) && level.getBlock(x + dx, y + dy, z + dz) !== 0)
        if (enclosed) changes.push([x, y, z, 0])
      }
      apply(player, level, changes, 'Hollow')
    }
  })

  ctx.command({
    name: 'outline',
    category: 'building',
    rank: 'AdvBuilder',
    usage: '/outline <block> <new block>',
    description: 'Surrounds a type of block with another one inside a selection',
    inGame: true,
    async run (player, args, { usage }) {
      if (args.length < 2) return usage()
      const level = player.level
      const target = level.parseBlock(args[0])
      if (target === null) throw new CommandError('Unknown block.')
      const block = blockArg(player, args[1])
      const marks = await select(player, 2, 'Outline')
      if (!marks) return
      const b = box(marks[0], marks[1])
      checkVolume(player, volumeOf(b))
      const changes = new Map()
      for (const [x, y, z] of eachIn(b)) {
        if (level.getBlock(x, y, z) !== target) continue
        for (const [dx, dy, dz] of NEIGHBORS) {
          const nx = x + dx; const ny = y + dy; const nz = z + dz
          if (level.inBounds(nx, ny, nz) && level.getBlock(nx, ny, nz) === 0) changes.set(level.index(nx, ny, nz), [nx, ny, nz, block])
        }
      }
      apply(player, level, [...changes.values()], 'Outline')
    }
  })

  ctx.command({
    name: 'pyramid',
    aliases: ['pd'],
    category: 'building',
    rank: 'AdvBuilder',
    usage: '/pyramid [block] [hollow]',
    description: 'Builds a pyramid on the base you mark (two corners)',
    inGame: true,
    async run (player, args) {
      const hollow = (args[args.length - 1] || '').toLowerCase() === 'hollow'
      if (hollow) args.pop()
      const block = blockArg(player, args[0])
      const marks = await select(player, 2, 'Pyramid base')
      if (!marks) return
      const b = box(marks[0], marks[1])
      const y0 = marks[0].y
      const changes = []
      for (let layer = 0; ; layer++) {
        const x1 = b.x1 + layer; const x2 = b.x2 - layer; const z1 = b.z1 + layer; const z2 = b.z2 - layer
        if (x1 > x2 || z1 > z2) break
        for (let x = x1; x <= x2; x++) {
          for (let z = z1; z <= z2; z++) {
            const edge = x === x1 || x === x2 || z === z1 || z === z2
            if (!hollow || edge) changes.push([x, y0 + layer, z, block])
          }
        }
      }
      apply(player, player.level, changes, 'Pyramid')
    }
  })

  const TREES = {
    oak (x, y, z, add, rand) {
      const h = 4 + Math.floor(rand() * 3)
      for (let dy = h - 2; dy <= h + 1; dy++) {
        const r = dy >= h ? 1 : 2
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && rand() < 0.5) continue
            add(x + dx, y + dy, z + dz, 18)
          }
        }
      }
      for (let dy = 0; dy < h; dy++) add(x, y + dy, z, 17)
    },
    big (x, y, z, add, rand) {
      const h = 8 + Math.floor(rand() * 4)
      for (let dy = 3; dy <= h + 2; dy++) {
        const r = Math.max(1, Math.round(4 - Math.abs(dy - (h - 2)) * 0.6))
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (dx * dx + dz * dz <= r * r + 1) add(x + dx, y + dy, z + dz, 18)
      }
      for (let dy = 0; dy < h; dy++) add(x, y + dy, z, 17)
    },
    cactus (x, y, z, add, rand) {
      const h = 3 + Math.floor(rand() * 3)
      for (let dy = 0; dy < h; dy++) add(x, y + dy, z, 25)
    },
    bush (x, y, z, add) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) add(x + dx, y, z + dz, 18)
      add(x, y + 1, z, 18)
    }
  }

  ctx.command({
    name: 'tree',
    category: 'building',
    rank: 'Builder',
    usage: `/tree [${Object.keys(TREES).join('|')}]`,
    description: 'Grows a tree on the block you mark',
    inGame: true,
    async run (player, args) {
      const type = (args[0] || 'oak').toLowerCase()
      const grow = TREES[type]
      if (!grow) throw new CommandError(`Tree types: ${Object.keys(TREES).join(', ')}`)
      const marks = await select(player, 1, 'Tree')
      if (!marks) return
      const { x, y, z } = marks[0]
      const level = player.level
      const changes = []
      // leaves never replace solid blocks; logs replace everything but bedrock
      grow(x, y + 1, z, (cx, cy, cz, b) => {
        if (!level.inBounds(cx, cy, cz)) return
        if (b === 18 && level.getBlock(cx, cy, cz) !== 0) return
        changes.push([cx, cy, cz, b])
      }, Math.random)
      apply(player, level, changes, 'Tree')
    }
  })

  ctx.command({
    name: 'torus',
    aliases: ['donut'],
    category: 'building',
    rank: 'AdvBuilder',
    usage: '/torus <block> <radius> <tube radius>',
    description: 'Draws a horizontal ring around the block you mark',
    inGame: true,
    async run (player, args, { usage }) {
      if (args.length < 3) return usage()
      const block = blockArg(player, args[0])
      const R = Number(args[1]); const r = Number(args[2])
      if (!(R >= 2 && R <= 100 && r >= 1 && r < R)) throw new CommandError('Radius 2-100, tube radius smaller than the radius.')
      checkVolume(player, Math.round(2 * Math.PI * Math.PI * R * r * r))
      const marks = await select(player, 1, 'Torus center')
      if (!marks) return
      const c = marks[0]
      const changes = []
      const ext = Math.ceil(R + r)
      for (let dx = -ext; dx <= ext; dx++) {
        for (let dz = -ext; dz <= ext; dz++) {
          const ring = Math.hypot(dx, dz) - R
          for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
            if (ring * ring + dy * dy <= r * r + 0.5) changes.push([c.x + dx, c.y + dy, c.z + dz, block])
          }
        }
      }
      apply(player, player.level, changes, 'Torus')
    }
  })

  ctx.command({
    name: 'spheroid',
    aliases: ['ellipsoid', 'e'],
    category: 'building',
    rank: 'AdvBuilder',
    usage: '/spheroid [block] [hollow]',
    description: 'Draws the ellipsoid that fits in a selection',
    inGame: true,
    async run (player, args) {
      const hollow = (args[args.length - 1] || '').toLowerCase() === 'hollow'
      if (hollow) args.pop()
      const block = blockArg(player, args[0])
      const marks = await select(player, 2, 'Spheroid')
      if (!marks) return
      const b = box(marks[0], marks[1])
      checkVolume(player, volumeOf(b))
      const cx = (b.x1 + b.x2) / 2; const cy = (b.y1 + b.y2) / 2; const cz = (b.z1 + b.z2) / 2
      const rx = (b.x2 - b.x1) / 2 + 0.5; const ry = (b.y2 - b.y1) / 2 + 0.5; const rz = (b.z2 - b.z1) / 2 + 0.5
      const inside = (x, y, z) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1
      const changes = []
      for (const [x, y, z] of eachIn(b)) {
        if (!inside(x, y, z)) continue
        if (hollow && NEIGHBORS.every(([dx, dy, dz]) => inside(x + dx, y + dy, z + dz))) continue
        changes.push([x, y, z, block])
      }
      apply(player, player.level, changes, 'Spheroid')
    }
  })

  // clipboard transforms

  const clip = (player) => {
    const c = clipboards.get(key(player))
    if (!c) throw new CommandError('You have not copied anything. Use /copy first.')
    return c
  }

  ctx.command({
    name: 'mirror',
    aliases: ['flip'],
    category: 'building',
    rank: 'AdvBuilder',
    usage: '/mirror <x|y|z>',
    description: 'Mirrors what you copied along an axis',
    inGame: true,
    run (player, args, { usage }) {
      const axis = ['x', 'y', 'z'].indexOf((args[0] || '').toLowerCase())
      if (axis === -1) return usage()
      const c = clip(player)
      for (const b of c.blocks) b[axis] = c.size[axis] - 1 - b[axis]
      player.message(`&eMirrored the copy along ${'xyz'[axis]}.`)
    }
  })

  ctx.command({
    name: 'spin',
    aliases: ['rotate'],
    category: 'building',
    rank: 'AdvBuilder',
    usage: '/spin <90|180|270>',
    description: 'Rotates what you copied around the vertical axis',
    inGame: true,
    run (player, args, { usage }) {
      const deg = Number(args[0])
      if (![90, 180, 270].includes(deg)) return usage()
      const c = clip(player)
      for (let n = 0; n < deg / 90; n++) {
        const [sx, , sz] = c.size
        for (const b of c.blocks) { const x = b[0]; b[0] = sz - 1 - b[2]; b[2] = x }
        c.size = [sz, c.size[1], sx]
      }
      player.message(`&eRotated the copy ${deg} degrees.`)
    }
  })

  ctx.command({
    name: 'mark',
    aliases: ['m'],
    category: 'building',
    usage: '/mark [x y z]',
    description: 'Marks your position (or coordinates) for the current selection',
    inGame: true,
    run (player, args) {
      if (!player.selection) throw new CommandError('You are not marking anything right now.')
      let p = player.blockPos
      if (args.length === 3) {
        const [x, y, z] = args.map(Number)
        if (![x, y, z].every(Number.isInteger)) throw new CommandError('Coordinates must be whole numbers.')
        p = { x, y, z }
      }
      const level = player.level
      p = { x: Math.max(0, Math.min(level.width - 1, p.x)), y: Math.max(0, Math.min(level.height - 1, p.y)), z: Math.max(0, Math.min(level.length - 1, p.z)) }
      player.addMark(p.x, p.y, p.z)
    }
  })

  ctx.command({
    name: 'drill',
    category: 'building',
    rank: 'AdvBuilder',
    usage: '/drill [distance]',
    description: 'Digs a 3x3 tunnel from the block you mark, in the direction you look',
    inGame: true,
    async run (player, args) {
      const dist = Math.min(200, Math.max(1, Number(args[0]) || 20))
      const marks = await select(player, 1, 'Drill')
      if (!marks) return
      const angle = player.yaw * 2 * Math.PI / 256
      const dx = Math.round(Math.sin(angle)); const dz = Math.round(-Math.cos(angle))
      const side = dx !== 0 ? [0, 0, 1] : [1, 0, 0]
      const { x, y, z } = marks[0]
      const level = player.level
      const changes = []
      for (let i = 0; i < dist; i++) {
        for (let a = -1; a <= 1; a++) {
          for (let dy = -1; dy <= 1; dy++) {
            const cx = x + dx * i + side[0] * a; const cy = y + dy; const cz = z + dz * i + side[2] * a
            const b = level.getBlock(cx, cy, cz)
            if (b !== 0 && b !== 7) changes.push([cx, cy, cz, 0])
          }
        }
      }
      apply(player, level, changes, 'Drill')
    }
  })

  ctx.command({
    name: 'rainbow',
    category: 'building',
    rank: 'AdvBuilder',
    usage: '/rainbow',
    description: 'Paints the solid blocks of a selection with rainbow colored wool',
    inGame: true,
    async run (player) {
      const marks = await select(player, 2, 'Rainbow')
      if (!marks) return
      const b = box(marks[0], marks[1])
      checkVolume(player, volumeOf(b))
      const level = player.level
      const changes = []
      for (const [x, y, z] of eachIn(b)) {
        if (level.getBlock(x, y, z) === 0) continue
        changes.push([x, y, z, RAINBOW[(x + y + z) % RAINBOW.length]])
      }
      apply(player, level, changes, 'Rainbow')
    }
  })

  ctx.command({
    name: 'maze',
    category: 'building',
    rank: 'AdvBuilder',
    usage: '/maze [block] [height]',
    description: 'Builds a random maze on the area you mark',
    inGame: true,
    async run (player, args) {
      const height = Number(args[1]) || 3
      const block = blockArg(player, args[0] || 'stone')
      const marks = await select(player, 2, 'Maze')
      if (!marks) return
      const b = box(marks[0], marks[1])
      const w = Math.floor((b.x2 - b.x1) / 2); const l = Math.floor((b.z2 - b.z1) / 2)
      if (w < 2 || l < 2) throw new CommandError('The area is too small for a maze.')
      checkVolume(player, (b.x2 - b.x1 + 1) * (b.z2 - b.z1 + 1) * height)
      // grid of cells: walls everywhere, then carve paths with a depth first search
      const W = w * 2 + 1; const L = l * 2 + 1
      const open = new Uint8Array(W * L)
      const stack = [[0, 0]]
      open[1 + 1 * W] = 1
      const visited = new Set(['0,0'])
      while (stack.length) {
        const [cx, cz] = stack[stack.length - 1]
        const next = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .map(([ox, oz]) => [cx + ox, cz + oz, ox, oz])
          .filter(([nx, nz]) => nx >= 0 && nz >= 0 && nx < w && nz < l && !visited.has(nx + ',' + nz))
        if (!next.length) { stack.pop(); continue }
        const [nx, nz, ox, oz] = next[Math.floor(Math.random() * next.length)]
        visited.add(nx + ',' + nz)
        open[(cx * 2 + 1 + ox) + (cz * 2 + 1 + oz) * W] = 1
        open[(nx * 2 + 1) + (nz * 2 + 1) * W] = 1
        stack.push([nx, nz])
      }
      open[1] = 1 // entrance
      open[(W - 2) + (L - 1) * W] = 1 // exit
      const changes = []
      for (let gx = 0; gx < W; gx++) {
        for (let gz = 0; gz < L; gz++) {
          for (let dy = 0; dy < height; dy++) changes.push([b.x1 + gx, b.y1 + dy, b.z1 + gz, open[gx + gz * W] ? 0 : block])
        }
      }
      apply(player, player.level, changes, 'Maze')
    }
  })

  ctx.command({
    name: 'center',
    aliases: ['centre'],
    category: 'building',
    rank: 'Builder',
    usage: '/center',
    description: 'Places gold at the center of a selection',
    inGame: true,
    async run (player) {
      const marks = await select(player, 2, 'Center')
      if (!marks) return
      const b = box(marks[0], marks[1])
      const xs = [Math.floor((b.x1 + b.x2) / 2), Math.ceil((b.x1 + b.x2) / 2)]
      const ys = [Math.floor((b.y1 + b.y2) / 2), Math.ceil((b.y1 + b.y2) / 2)]
      const zs = [Math.floor((b.z1 + b.z2) / 2), Math.ceil((b.z1 + b.z2) / 2)]
      const changes = new Map()
      for (const x of xs) for (const y of ys) for (const z of zs) changes.set(`${x},${y},${z}`, [x, y, z, 41])
      apply(player, player.level, [...changes.values()], 'Center')
      player.message(`&eCenter: &f${(b.x1 + b.x2) / 2} ${(b.y1 + b.y2) / 2} ${(b.z1 + b.z2) / 2}`)
    }
  })

  ctx.command({
    name: 'calculate',
    aliases: ['calc'],
    category: 'other',
    usage: '/calculate <expression>',
    description: 'Calculates things like 12*(3+4)/2, sqrt(2) or 2^10',
    run (player, args, { usage, raw }) {
      if (!raw) return usage()
      let result
      try {
        result = evaluate(raw)
      } catch (err) {
        throw new CommandError(err.message)
      }
      player.message(`&e${raw} = &f${Number.isInteger(result) ? result : Number(result.toFixed(6))}`)
    }
  })

  // placing one block puts another one

  ctx.on('blockChange', (ev) => {
    if (!ev.placing) return
    const p = ev.player
    const replacement = p.data['building.mode'] ?? (p.data['building.binds'] && p.data['building.binds'].get(ev.block))
    if (replacement === undefined || replacement === null) return
    if (!server.blockPerms.canPlace(p, replacement)) return
    ev.block = replacement
  }, { priority: 'low' })

  ctx.command({
    name: 'bind',
    category: 'building',
    rank: 'Builder',
    usage: '/bind <block> [replacement] | /bind clear',
    description: 'Placing the first block places the second one instead',
    inGame: true,
    run (player, args, { usage }) {
      const binds = player.data['building.binds'] || (player.data['building.binds'] = new Map())
      if ((args[0] || '').toLowerCase() === 'clear') { binds.clear(); return player.message('&eBinds cleared.') }
      const level = player.level
      const from = level.parseBlock(args[0])
      if (from === null) return usage()
      if (!args[1]) { binds.delete(from); return player.message(`&e${level.blockName(from)} is no longer bound.`) }
      const to = blockArg(player, args[1])
      binds.set(from, to)
      player.message(`&ePlacing ${level.blockName(from)} now places ${level.blockName(to)}.`)
    }
  })

  ctx.command({
    name: 'mode',
    category: 'building',
    rank: 'Builder',
    usage: '/mode [block]',
    description: 'Every block you place becomes this block (no block: turn off)',
    inGame: true,
    run (player, args) {
      if (!args[0]) {
        player.data['building.mode'] = null
        return player.message('&eMode off.')
      }
      const block = blockArg(player, args[0])
      player.data['building.mode'] = block
      player.message(`&eEvery block you place is now ${player.level.blockName(block)}. Type &f/mode&e to stop.`)
    }
  })
  ctx.on('playerAbort', ({ player }) => { player.data['building.mode'] = null })
}

// A small expression evaluator: + - * / % ^, parentheses, pi, e and a few functions
function evaluate (input) {
  const tokens = input.toLowerCase().match(/\d+(\.\d+)?|[a-z]+|[-+*/%^(),]/g)
  if (!tokens || tokens.join('') !== input.toLowerCase().replace(/\s+/g, '')) throw new CalcError('I can only do numbers, + - * / % ^, parentheses and sqrt, abs, sin, cos, tan, log, round, floor, ceil.')
  const FUNCS = { sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, round: Math.round, floor: Math.floor, ceil: Math.ceil }
  let i = 0
  const peek = () => tokens[i]
  const take = () => tokens[i++]
  const expr = () => {
    let v = term()
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + term() : v - term()
    return v
  }
  const term = () => {
    let v = power()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = take(); const r = power()
      v = op === '*' ? v * r : op === '/' ? v / r : v % r
    }
    return v
  }
  const power = () => {
    const base = unary()
    if (peek() === '^') { take(); return base ** power() }
    return base
  }
  const unary = () => {
    if (peek() === '-') { take(); return -unary() }
    if (peek() === '+') { take(); return unary() }
    return atom()
  }
  const atom = () => {
    const t = take()
    if (t === undefined) throw new CalcError('The expression is incomplete.')
    if (t === '(') { const v = expr(); if (take() !== ')') throw new CalcError('Missing ")".'); return v }
    if (/^\d/.test(t)) return Number(t)
    if (t === 'pi') return Math.PI
    if (t === 'e') return Math.E
    if (FUNCS[t]) {
      if (take() !== '(') throw new CalcError(`${t} needs parentheses, like ${t}(2).`)
      const v = expr()
      if (take() !== ')') throw new CalcError('Missing ")".')
      return FUNCS[t](v)
    }
    throw new CalcError(`I don't know "${t}".`)
  }
  const result = expr()
  if (i < tokens.length) throw new CalcError(`Unexpected "${tokens[i]}".`)
  if (!Number.isFinite(result)) throw new CalcError('The result is not a number.')
  return result
}

class CalcError extends Error {}
module.exports.evaluate = evaluate
module.exports.CalcError = CalcError
