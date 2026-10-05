'use strict'

// Drawing and editing tools: /cuboid, /replace, /line, /sphere, /fill, /copy, /paste, /undo, /redo, /paint, /about...
// Other plugins (like zones) can filter draw operations through the 'drawOperation' event.

const path = require('path')
const { BlockLog } = require('./block-log')
const font = require('./font')

const MAX_UNDO_OPS = 30
const HISTORY_PER_LEVEL = 300000

module.exports = {
  name: 'core-building',
  version: '2.0.0',
  description: 'Building and drawing commands with undo/redo and block history',
  author: 'MCScript',

  load (ctx) {
    const { server, CommandError } = ctx
    const undo = new Map() // player name -> [{ level, changes: [[index, old, new]], time }]
    const redo = new Map()
    const history = new Map() // level name -> Map(index -> { name, time, from, to })
    const clipboards = new Map()
    // every change is also written to disk, so history and /undoplayer survive restarts
    const log = new BlockLog(path.join(ctx.dataDir, 'history'))
    ctx.setInterval(() => log.flush(), 5000)
    ctx.onUnload(() => log.flush())

    const loadHistory = (level) => {
      const map = new Map()
      for (const r of log.recent(level.name, HISTORY_PER_LEVEL)) {
        map.delete(r.index)
        map.set(r.index, { name: r.name, time: r.time, from: r.from, to: r.to })
      }
      history.set(level.name, map)
    }
    for (const level of server.levels.loaded.values()) loadHistory(level)
    ctx.on('levelLoad', ({ level }) => loadHistory(level))

    // helpers

    const key = p => p.name.toLowerCase()

    async function select (player, count, label) {
      const level = player.level
      try {
        const marks = await player.selectBlocks(count, label)
        if (player.level !== level) return null
        return marks
      } catch (err) {
        if (err.cancelled) return null
        throw err
      }
    }

    function blockArg (player, arg) {
      const level = player.level
      let block
      if (arg === undefined) {
        if (!player.supports('HeldBlock')) throw new CommandError('Specify a block, e.g. stone or 1.')
        block = player.heldBlock
      } else {
        block = level.parseBlock(arg)
        if (block === null) throw new CommandError(`Unknown block "${arg}".`)
      }
      if (!server.blockPerms.canPlace(player, block)) throw new CommandError(`You can't place ${level.blockName(block)}.`)
      return block
    }

    function checkVolume (player, volume) {
      const limit = player.permission === Infinity ? Infinity : player.rank.drawLimit
      if (volume > limit) throw new CommandError(`You tried to change ${volume.toLocaleString()} blocks, your limit is ${Number(limit).toLocaleString()}.`)
    }

    function box (a, b) {
      return {
        x1: Math.min(a.x, b.x),
        y1: Math.min(a.y, b.y),
        z1: Math.min(a.z, b.z),
        x2: Math.max(a.x, b.x),
        y2: Math.max(a.y, b.y),
        z2: Math.max(a.z, b.z)
      }
    }

    function recordHistory (level, name, changes) {
      let map = history.get(level.name)
      if (!map) history.set(level.name, (map = new Map()))
      const time = Date.now()
      log.append(level.name, name, changes, time)
      for (const [index, from, to] of changes) {
        map.delete(index)
        map.set(index, { name, time, from, to })
      }
      while (map.size > HISTORY_PER_LEVEL) map.delete(map.keys().next().value)
    }

    function pushUndo (player, level, changes, merge = false) {
      if (player.isConsole || !changes.length) return
      const stack = undo.get(key(player)) || []
      const last = stack[stack.length - 1]
      if (merge && last && last.manual && last.level === level && Date.now() - last.time < 60000) {
        last.changes.push(...changes)
        last.time = Date.now()
      } else {
        stack.push({ level, changes, time: Date.now(), manual: merge })
      }
      // respect the rank's undo limit (total blocks) and max operations
      let total = stack.reduce((n, op) => n + op.changes.length, 0)
      while (stack.length > 1 && (stack.length > MAX_UNDO_OPS || total > player.rank.maxUndo)) total -= stack.shift().changes.length
      undo.set(key(player), stack)
      if (!merge) redo.delete(key(player))
    }

    // Applies [[x, y, z, block], ...] as a player, with permission checks
    function apply (player, level, changes, opName) {
      if (!level.canBuild(player)) {
        throw new CommandError(`You are not allowed to build in ${level.name}.`)
      }
      checkVolume(player, changes.length)
      const allowed = []
      const denied = new Set()
      for (const c of changes) {
        const [x, y, z, block] = c
        if (!level.inBounds(x, y, z)) continue
        const old = level.getBlock(x, y, z)
        if (old === block) continue
        if (!server.blockPerms.canDelete(player, old)) { denied.add(old); continue }
        allowed.push(c)
      }
      const ev = server.events.fire('drawOperation', { player, level, changes: allowed, name: opName })
      if (ev.cancelled) throw new CommandError(ev.cancelReason || 'You can\'t draw here.')
      const record = []
      for (const [x, y, z, block] of ev.changes) {
        const index = level.index(x, y, z)
        record.push([index, level.getAt(index), block])
      }
      level.setBlocks(ev.changes)
      pushUndo(player, level, record)
      recordHistory(level, player.name, record)
      let msg = `&e${opName}: changed &f${record.length.toLocaleString()}&e block${record.length === 1 ? '' : 's'}.`
      if (denied.size) msg += ` &7(skipped blocks you can't delete: ${[...denied].map(b => level.blockName(b)).join(', ')})`
      player.message(msg)
      return record.length
    }

    function * cuboid (b, block, mode) {
      for (let y = b.y1; y <= b.y2; y++) {
        for (let z = b.z1; z <= b.z2; z++) {
          for (let x = b.x1; x <= b.x2; x++) {
            const edgeX = x === b.x1 || x === b.x2
            const edgeY = y === b.y1 || y === b.y2
            const edgeZ = z === b.z1 || z === b.z2
            if (mode === 'hollow' && !(edgeX || edgeY || edgeZ)) continue
            if (mode === 'walls' && !(edgeX || edgeZ)) continue
            if (mode === 'wire' && [edgeX, edgeY, edgeZ].filter(Boolean).length < 2) continue
            yield [x, y, z, block]
          }
        }
      }
    }

    const volumeOf = b => (b.x2 - b.x1 + 1) * (b.y2 - b.y1 + 1) * (b.z2 - b.z1 + 1)

    // commands

    ctx.command({
      name: 'cuboid',
      aliases: ['z', 'box', 'cube'],
      category: 'building',
      rank: 'Builder',
      usage: '/cuboid [block] [solid|hollow|walls|wire]',
      description: 'Fills the box between two marked corners',
      inGame: true,
      async run (player, args) {
        const modes = ['solid', 'hollow', 'walls', 'wire']
        let mode = 'solid'
        if (args.length && modes.includes(args[args.length - 1].toLowerCase())) mode = args.pop().toLowerCase()
        const block = blockArg(player, args[0])
        const marks = await select(player, 2, 'Cuboid')
        if (!marks) return
        const b = box(marks[0], marks[1])
        if (mode === 'solid') checkVolume(player, volumeOf(b))
        apply(player, player.level, [...cuboid(b, block, mode)], 'Cuboid')
      }
    })

    ctx.command({
      name: 'replace',
      aliases: ['r', 'rp'],
      category: 'building',
      rank: 'Builder',
      usage: '/replace <block[,block2,...]> <new block>',
      description: 'Replaces blocks inside a marked box',
      inGame: true,
      async run (player, args, { usage }) {
        if (args.length < 2) return usage()
        const level = player.level
        const from = new Set(args[0].split(',').map(a => {
          const b = level.parseBlock(a)
          if (b === null) throw new CommandError(`Unknown block "${a}".`)
          return b
        }))
        const to = blockArg(player, args[1])
        const marks = await select(player, 2, 'Replace')
        if (!marks) return
        const b = box(marks[0], marks[1])
        checkVolume(player, volumeOf(b))
        const changes = []
        for (const [x, y, z] of cuboid(b, 0, 'solid')) if (from.has(level.getBlock(x, y, z))) changes.push([x, y, z, to])
        apply(player, level, changes, 'Replace')
      }
    })

    ctx.command({
      name: 'replaceall',
      aliases: ['ra'],
      category: 'building',
      rank: 'Operator',
      usage: '/replaceall <block> <new block>',
      description: 'Replaces a block in the whole level',
      inGame: true,
      run (player, args, { usage }) {
        if (args.length < 2) return usage()
        const level = player.level
        const from = level.parseBlock(args[0])
        if (from === null) throw new CommandError(`Unknown block "${args[0]}".`)
        const to = blockArg(player, args[1])
        const changes = []
        for (let i = 0; i < level.volume; i++) {
          if (level.getAt(i) !== from) continue
          const { x, y, z } = level.unpack(i)
          changes.push([x, y, z, to])
        }
        apply(player, level, changes, 'Replace all')
      }
    })

    ctx.command({
      name: 'line',
      aliases: ['l'],
      category: 'building',
      rank: 'Builder',
      usage: '/line [block]',
      description: 'Draws a straight line between two marks',
      inGame: true,
      async run (player, args) {
        const block = blockArg(player, args[0])
        const marks = await select(player, 2, 'Line')
        if (!marks) return
        const [a, b] = marks
        const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z))
        const changes = []
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 0 : i / steps
          changes.push([Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t), Math.round(a.z + (b.z - a.z) * t), block])
        }
        apply(player, player.level, changes, 'Line')
      }
    })

    ctx.command({
      name: 'sphere',
      aliases: ['sp', 'ball'],
      category: 'building',
      rank: 'Builder',
      usage: '/sphere [block] [radius] [hollow]',
      description: 'Draws a sphere. Mark the center (and a point on the edge if no radius is given)',
      inGame: true,
      async run (player, args) {
        const hollow = args.length && args[args.length - 1].toLowerCase() === 'hollow'
        if (hollow) args.pop()
        // "/sphere stone 5", "/sphere 5" (block in hand) or "/sphere stone" (mark the radius)
        let radius = null
        const numeric = a => /^\d+$/.test(a)
        if (args.length >= 2 && numeric(args[args.length - 1])) radius = Number(args.pop())
        else if (args.length === 1 && numeric(args[0]) && player.supports('HeldBlock')) radius = Number(args.pop())
        const block = blockArg(player, args[0])
        const marks = await select(player, radius === null ? 2 : 1, 'Sphere')
        if (!marks) return
        const c = marks[0]
        if (radius === null) radius = Math.round(Math.hypot(marks[1].x - c.x, marks[1].y - c.y, marks[1].z - c.z))
        if (radius < 1 || radius > 200) throw new CommandError('Radius must be between 1 and 200.')
        checkVolume(player, Math.round(4 / 3 * Math.PI * radius ** 3))
        const changes = []
        const r2 = (radius + 0.5) ** 2
        const inner = (radius - 0.5) ** 2
        for (let y = -radius; y <= radius; y++) {
          for (let z = -radius; z <= radius; z++) {
            for (let x = -radius; x <= radius; x++) {
              const d = x * x + y * y + z * z
              if (d > r2 || (hollow && d < inner)) continue
              changes.push([c.x + x, c.y + y, c.z + z, block])
            }
          }
        }
        apply(player, player.level, changes, 'Sphere')
      }
    })

    ctx.command({
      name: 'fill',
      aliases: ['f', 'floodfill'],
      category: 'building',
      rank: 'AdvBuilder',
      usage: '/fill [block] [3d|layer]',
      description: 'Flood fills the connected area of the block you mark',
      inGame: true,
      async run (player, args) {
        let mode = '3d'
        if (args.length && ['3d', 'layer'].includes(args[args.length - 1].toLowerCase())) mode = args.pop().toLowerCase()
        const block = blockArg(player, args[0])
        const marks = await select(player, 1, 'Fill')
        if (!marks) return
        const level = player.level
        const start = marks[0]
        const target = level.getBlock(start.x, start.y, start.z)
        if (target === block) throw new CommandError('That area is already that block.')
        const limit = player.rank.drawLimit
        const seen = new Set()
        const queue = [level.index(start.x, start.y, start.z)]
        const changes = []
        const dirs = mode === 'layer' ? [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] : [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
        seen.add(queue[0])
        while (queue.length) {
          const i = queue.pop()
          const { x, y, z } = level.unpack(i)
          changes.push([x, y, z, block])
          if (changes.length > limit) throw new CommandError(`The area is bigger than your draw limit (${limit}).`)
          for (const [dx, dy, dz] of dirs) {
            const nx = x + dx; const ny = y + dy; const nz = z + dz
            if (!level.inBounds(nx, ny, nz)) continue
            const ni = level.index(nx, ny, nz)
            if (seen.has(ni) || level.getAt(ni) !== target) continue
            seen.add(ni)
            queue.push(ni)
          }
        }
        apply(player, level, changes, 'Fill')
      }
    })

    ctx.command({
      name: 'place',
      aliases: ['pb'],
      category: 'building',
      rank: 'Builder',
      usage: '/place <block> [x y z]',
      description: 'Places a block at your feet or at coordinates',
      inGame: true,
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const block = blockArg(player, args[0])
        let pos = player.blockPos
        if (args.length === 4) {
          const [x, y, z] = args.slice(1).map(Number)
          if (![x, y, z].every(Number.isInteger)) return usage()
          pos = { x, y, z }
        }
        apply(player, player.level, [[pos.x, pos.y, pos.z, block]], 'Place')
      }
    })

    ctx.command({
      name: 'copy',
      aliases: ['c'],
      category: 'building',
      rank: 'AdvBuilder',
      usage: '/copy [air]',
      description: 'Copies the blocks between two marks (add "air" to also copy air)',
      inGame: true,
      async run (player, args) {
        const withAir = (args[0] || '').toLowerCase() === 'air'
        const marks = await select(player, 2, 'Copy')
        if (!marks) return
        const b = box(marks[0], marks[1])
        checkVolume(player, volumeOf(b))
        const level = player.level
        const blocks = []
        for (const [x, y, z] of cuboid(b, 0, 'solid')) {
          const block = level.getBlock(x, y, z)
          if (block !== 0 || withAir) blocks.push([x - b.x1, y - b.y1, z - b.z1, block])
        }
        clipboards.set(key(player), { blocks, size: [b.x2 - b.x1 + 1, b.y2 - b.y1 + 1, b.z2 - b.z1 + 1] })
        player.message(`&eCopied &f${blocks.length}&e blocks. Use &f/paste&e to place them.`)
      }
    })

    ctx.command({
      name: 'paste',
      aliases: ['ps'],
      category: 'building',
      rank: 'AdvBuilder',
      usage: '/paste [rotate 90|180|270]',
      description: 'Pastes the copied blocks at the marked position (the lowest corner)',
      inGame: true,
      async run (player, args) {
        const clip = clipboards.get(key(player))
        if (!clip) throw new CommandError('You have not copied anything. Use /copy first.')
        const rot = (args[0] || '').toLowerCase() === 'rotate' ? Number(args[1]) : 0
        if (![0, 90, 180, 270].includes(rot)) throw new CommandError('Rotation must be 90, 180 or 270.')
        const marks = await select(player, 1, 'Paste')
        if (!marks) return
        const o = marks[0]
        const [sx, , sz] = clip.size
        const changes = clip.blocks.map(([x, y, z, block]) => {
          let rx = x; let rz = z
          if (rot === 90) { rx = sz - 1 - z; rz = x } else if (rot === 180) { rx = sx - 1 - x; rz = sz - 1 - z } else if (rot === 270) { rx = z; rz = sx - 1 - x }
          return [o.x + rx, o.y + y, o.z + rz, block]
        })
        apply(player, player.level, changes, 'Paste')
      }
    })

    ctx.command({
      name: 'undo',
      aliases: ['u'],
      category: 'building',
      usage: '/undo [count]',
      description: 'Undoes your last changes',
      inGame: true,
      run (player, args) {
        const count = Math.max(1, Math.min(MAX_UNDO_OPS, Number(args[0]) || 1))
        const stack = undo.get(key(player)) || []
        if (!stack.length) throw new CommandError('Nothing to undo.')
        let total = 0
        for (let n = 0; n < count && stack.length; n++) {
          const op = stack.pop()
          const level = op.level
          if (server.levels.get(level.name) !== level) { player.message(`&7Skipped changes in ${level.name} (not loaded).`); continue }
          const changes = []
          const undone = []
          for (let i = op.changes.length - 1; i >= 0; i--) {
            const [index, from, to] = op.changes[i]
            if (level.getAt(index) !== to) continue // changed again later by someone else
            const { x, y, z } = level.unpack(index)
            changes.push([x, y, z, from])
            undone.push([index, to, from])
          }
          level.setBlocks(changes)
          recordHistory(level, player.name + ' (undo)', undone)
          const r = redo.get(key(player)) || []
          r.push({ level, changes: op.changes, time: Date.now() })
          redo.set(key(player), r.slice(-MAX_UNDO_OPS))
          total += changes.length
        }
        player.message(`&eUndone &f${total}&e block changes. &7(/redo to restore)`)
      }
    })

    ctx.command({
      name: 'undoplayer',
      aliases: ['up', 'undoothers'],
      category: 'building',
      usage: '/undoplayer <player> [time, default 30m] [level]',
      description: 'Undoes a player\'s changes in a time span (also after restarts). Undoing others needs Operator.',
      run (player, args, { usage }) {
        if (!args[0]) return usage()
        const target = args[0]
        const ms = args[1] ? ctx.text.parseDuration(args[1]) : 30 * 60000
        if (!ms) return usage()
        const level = args[2] ? server.levels.get(args[2]) : player.level
        if (!level) throw new CommandError('That level is not loaded.')
        const self = !player.isConsole && target.toLowerCase() === player.name.toLowerCase()
        if (!self) {
          if (player.permission < server.ranks.permissionOf('Operator')) throw new CommandError('Only operators can undo other players.')
          const record = server.playerDB.get(target)
          if (record && (server.ranks.get(record.rank) || server.ranks.default).permission >= player.permission) {
            throw new CommandError(`You can't undo ${target}'s changes, their rank is not lower than yours.`)
          }
        }
        // newest first: remember the newest "to" and the oldest "from" of each block
        const blocks = new Map()
        for (const r of log.search(level.name, { name: target, since: Date.now() - ms })) {
          const b = blocks.get(r.index)
          if (b) b.from = r.from
          else blocks.set(r.index, { from: r.from, to: r.to })
        }
        const changes = []
        const undone = []
        for (const [index, b] of blocks) {
          if (level.getAt(index) !== b.to) continue // someone changed it afterwards
          const { x, y, z } = level.unpack(index)
          changes.push([x, y, z, b.from])
          undone.push([index, b.to, b.from])
        }
        level.setBlocks(changes)
        recordHistory(level, `${player.name} (undo)`, undone)
        player.message(`&eUndid &f${changes.length}&e block changes by ${target} in the last ${ctx.text.formatDuration(ms)}.`)
      }
    })

    ctx.command({
      name: 'redo',
      category: 'building',
      usage: '/redo',
      description: 'Redoes what you last undid',
      inGame: true,
      run (player) {
        const stack = redo.get(key(player)) || []
        const op = stack.pop()
        if (!op) throw new CommandError('Nothing to redo.')
        const changes = []
        for (const [index, from, to] of op.changes) {
          if (op.level.getAt(index) !== from) continue
          const { x, y, z } = op.level.unpack(index)
          changes.push([x, y, z, to])
        }
        op.level.setBlocks(changes)
        const stackUndo = undo.get(key(player)) || []
        stackUndo.push({ level: op.level, changes: op.changes, time: Date.now() })
        undo.set(key(player), stackUndo)
        player.message(`&eRedone &f${changes.length}&e block changes.`)
      }
    })

    ctx.command({
      name: 'paint',
      aliases: ['p'],
      category: 'building',
      rank: 'Builder',
      usage: '/paint',
      description: 'Toggles paint mode: breaking a block replaces it with the block you hold',
      inGame: true,
      run (player) {
        if (!player.supports('HeldBlock')) throw new CommandError('Your client does not support paint mode.')
        player.data['building.paint'] = !player.data['building.paint']
        player.message(`&ePaint mode ${player.data['building.paint'] ? '&aON' : '&cOFF'}&e.`)
      }
    })

    ctx.command({
      name: 'about',
      aliases: ['b', 'binfo', 'blockinfo'],
      category: 'building',
      usage: '/about',
      description: 'Shows information and history of a block you mark',
      inGame: true,
      async run (player) {
        const marks = await select(player, 1, 'About')
        if (!marks) return
        const { x, y, z } = marks[0]
        const level = player.level
        const id = level.getBlock(x, y, z)
        player.message(`&eBlock (${x}, ${y}, ${z}): &f${level.blockName(id)}&7 (id ${id})`)
        const h = history.get(level.name)
        const entry = h && h.get(level.index(x, y, z))
        if (entry) {
          player.message(`&7  Last changed by &f${entry.name}&7 ${ctx.text.formatDuration(Date.now() - entry.time)} ago: ${level.blockName(entry.from)} -> ${level.blockName(entry.to)}`)
        } else {
          player.message('&7  No changes recorded since the server started.')
        }
      }
    })

    ctx.command({
      name: 'write',
      aliases: ['text', 'writetext'],
      category: 'building',
      rank: 'Builder',
      usage: '/write <block> [scale 1-4] <text>',
      description: 'Writes text with blocks. Mark where it starts, then a block in the direction to write',
      inGame: true,
      async run (player, args, { usage }) {
        if (args.length < 2) return usage()
        const block = blockArg(player, args.shift())
        let scale = 1
        if (args.length > 1 && /^[1-4]$/.test(args[0])) scale = Number(args.shift())
        const message = args.join(' ')
        const { pixels, width } = font.layout(message)
        if (!pixels.length) throw new CommandError('Nothing to write (unsupported characters).')
        checkVolume(player, pixels.length * scale * scale)
        const marks = await select(player, 2, 'Write')
        if (!marks) return
        const [a, b] = marks
        // write along the horizontal axis that points the most from the first mark to the second
        const dx = b.x - a.x; const dz = b.z - a.z
        const dir = Math.abs(dx) >= Math.abs(dz) ? { x: Math.sign(dx) || 1, z: 0 } : { x: 0, z: Math.sign(dz) || 1 }
        const changes = []
        for (const [px, py] of pixels) {
          for (let sx = 0; sx < scale; sx++) {
            for (let sy = 0; sy < scale; sy++) {
              const along = px * scale + sx
              changes.push([a.x + dir.x * along, a.y + py * scale + sy, a.z + dir.z * along, block])
            }
          }
        }
        apply(player, player.level, changes, `Write (${width * scale} blocks long)`)
      }
    })

    ctx.command({
      name: 'measure',
      aliases: ['ms'],
      category: 'building',
      usage: '/measure [block]',
      description: 'Measures the box between two marks (and counts a block if given)',
      inGame: true,
      async run (player, args) {
        const count = args[0] !== undefined ? player.level.parseBlock(args[0]) : null
        if (args[0] !== undefined && count === null) throw new CommandError('Unknown block.')
        const marks = await select(player, 2, 'Measure')
        if (!marks) return
        const b = box(marks[0], marks[1])
        let msg = `&eSize: &f${b.x2 - b.x1 + 1} x ${b.y2 - b.y1 + 1} x ${b.z2 - b.z1 + 1}&e = &f${volumeOf(b).toLocaleString()}&e blocks`
        if (count !== null) {
          let n = 0
          for (const [x, y, z] of cuboid(b, 0, 'solid')) if (player.level.getBlock(x, y, z) === count) n++
          msg += `, &f${n}&e of them are ${player.level.blockName(count)}`
        }
        player.message(msg)
      }
    })

    require('./more')(ctx, { select, blockArg, checkVolume, box, apply, clipboards, key })
    require('./tools')(ctx, { select, blockArg, checkVolume, box, apply })

    // manual building

    ctx.on('blockChange', (ev) => {
      if (!ev.placing && ev.player.data['building.paint']) ev.block = ev.player.heldBlock
    }, { priority: 'low' })

    ctx.on('blockChange', (ev) => {
      if (ev.cancelled) return
      const index = ev.level.index(ev.x, ev.y, ev.z)
      const change = [[index, ev.oldBlock, ev.block]]
      pushUndo(ev.player, ev.level, change, true)
      recordHistory(ev.level, ev.player.name, change)
    }, { priority: 'monitor' })

    ctx.on('playerAbort', ({ player }) => { player.data['building.paint'] = false })
    ctx.on('levelUnload', ({ level }) => { history.delete(level.name) }, { priority: 'monitor' })

    module.exports.api = { apply, history }
  }
}
