'use strict'

// /replacenot /triangle /delete /static, as in MCGalaxy

module.exports = function tools (ctx, h) {
  const { server, CommandError } = ctx
  const { select, blockArg, checkVolume, box, apply } = h

  ctx.command({
    name: 'replacenot',
    category: 'building',
    rank: 'Builder',
    usage: '/replacenot <block> <new block>',
    description: 'Replaces everything except one block inside a marked box (air too)',
    inGame: true,
    async run (player, args, { usage }) {
      if (args.length < 2) return usage()
      const level = player.level
      const keep = level.parseBlock(args[0])
      if (keep === null) throw new CommandError(`Unknown block "${args[0]}".`)
      const to = blockArg(player, args[1])
      const marks = await select(player, 2, 'Replace not')
      if (!marks) return
      const b = box(marks[0], marks[1])
      checkVolume(player, (b.x2 - b.x1 + 1) * (b.y2 - b.y1 + 1) * (b.z2 - b.z1 + 1))
      const changes = []
      for (let y = b.y1; y <= b.y2; y++) {
        for (let z = b.z1; z <= b.z2; z++) {
          for (let x = b.x1; x <= b.x2; x++) if (level.getBlock(x, y, z) !== keep) changes.push([x, y, z, to])
        }
      }
      apply(player, level, changes, 'Replace not')
    }
  })

  ctx.command({
    name: 'triangle',
    category: 'building',
    rank: 'AdvBuilder',
    usage: '/triangle [block]',
    description: 'Fills the triangle between three marked corners',
    inGame: true,
    async run (player, args) {
      const block = blockArg(player, args[0])
      const marks = await select(player, 3, 'Triangle')
      if (!marks) return
      const [a, b, c] = marks
      const len = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)
      // sample the triangle densely enough that no block is skipped
      const steps = Math.max(1, Math.ceil(2 * Math.max(len(a, b), len(a, c), len(b, c))))
      checkVolume(player, Math.ceil(steps * steps / 8))
      const seen = new Set()
      const changes = []
      for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps - i; j++) {
          const u = i / steps; const v = j / steps
          const x = Math.round(a.x + (b.x - a.x) * u + (c.x - a.x) * v)
          const y = Math.round(a.y + (b.y - a.y) * u + (c.y - a.y) * v)
          const z = Math.round(a.z + (b.z - a.z) * u + (c.z - a.z) * v)
          const k = `${x},${y},${z}`
          if (seen.has(k) || !player.level.inBounds(x, y, z)) continue
          seen.add(k)
          changes.push([x, y, z, block])
        }
      }
      apply(player, player.level, changes, 'Triangle')
    }
  })

  ctx.command({
    name: 'delete',
    category: 'building',
    rank: 'Builder',
    usage: '/delete',
    description: 'Removes the block you mark (use /static delete to keep going)',
    inGame: true,
    async run (player) {
      const marks = await select(player, 1, 'Delete')
      if (!marks) return
      const { x, y, z } = marks[0]
      apply(player, player.level, [[x, y, z, 0]], 'Delete')
    }
  })

  // /static <command>: runs a drawing command again each time it finishes, until /abort
  ctx.on('playerAbort', ({ player }) => { player.data['building.static'] = false })
  ctx.command({
    name: 'static',
    category: 'building',
    rank: 'Builder',
    usage: '/static <command> [args]',
    description: 'Repeats a drawing command (for example /static cuboid stone) until you type /abort',
    inGame: true,
    async run (player, args, { usage }) {
      if (!args.length) {
        if (player.data['building.static']) { player.data['building.static'] = false; return player.message('&eStatic mode off.') }
        return usage()
      }
      const cmd = server.commands.find(args[0])
      if (!cmd) throw new CommandError(`Unknown command "/${args[0]}".`)
      if (cmd.name === 'static') throw new CommandError('That would never end.')
      if (cmd.category !== 'building') throw new CommandError('Static mode only works with building commands.')
      player.data['building.static'] = true
      player.message(`&eStatic mode: /${args.join(' ')} repeats until you type &f/abort&e.`)
      const line = '/' + args.join(' ')
      for (let i = 0; i < 1000 && player.data['building.static'] && !player.conn.closed; i++) {
        const before = Date.now()
        await server.commands.execute(player, line)
        // a command that didn't wait for marks would spin; stop instead
        if (Date.now() - before < 50) break
      }
      player.data['building.static'] = false
    }
  })
}
