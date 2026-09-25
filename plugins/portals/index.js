'use strict'

// Portals (walk into a block to be teleported, even to another level) and
// message blocks (walk into or click a block to see a message or run a command).
// Both are stored inside the level file (level.meta).

module.exports = {
  name: 'portals',
  version: '1.0.0',
  description: 'Portals and message blocks',
  author: 'MCScript',

  load (ctx) {
    const { server, CommandError, text } = ctx

    const portalsOf = level => (level.meta.portals = level.meta.portals || {})
    const mbsOf = level => (level.meta.messageBlocks = level.meta.messageBlocks || {})

    const markOne = async (player, label) => {
      try {
        const [m] = await player.selectBlocks(1, label)
        return m
      } catch (err) {
        return null
      }
    }

    const usePortal = (player, portal) => {
      let level = server.levels.get(portal.level)
      if (!level) {
        if (!server.levels.exists(portal.level)) return player.message('&cThis portal leads to a level that no longer exists.')
        level = server.levels.load(portal.level)
      }
      if (level !== player.level && !player.changeLevel(level)) return
      player.teleport(portal.x, portal.y, portal.z, portal.yaw, portal.pitch)
    }

    const useMessageBlock = (player, msg) => {
      if (msg.startsWith('/')) server.commands.execute(player, msg)
      else player.message(msg)
    }

    // returns true if something was triggered
    const trigger = (player, level, index) => {
      const portal = portalsOf(level)[index]
      if (portal) { usePortal(player, portal); return true }
      const mb = mbsOf(level)[index]
      if (mb) { useMessageBlock(player, mb); return true }
      return false
    }

    ctx.on('playerMove', (ev) => {
      const { player, to } = ev
      const level = player.level
      const x = Math.floor(to.x / 32); const z = Math.floor(to.z / 32)
      const feet = Math.floor((to.y - 51) / 32)
      if (!level.inBounds(x, feet, z)) return
      const feetIndex = level.index(x, feet, z)
      if (player.data['portals.last'] === feetIndex) return
      player.data['portals.last'] = feetIndex
      if (trigger(player, level, feetIndex)) return
      if (level.inBounds(x, feet + 1, z)) trigger(player, level, level.index(x, feet + 1, z))
    })

    ctx.on('playerClick', (ev) => {
      if (ev.action !== 'press' || !ev.target) return
      const level = ev.player.level
      const { x, y, z } = ev.target
      if (!level.inBounds(x, y, z)) return
      const mb = mbsOf(level)[level.index(x, y, z)]
      if (mb) useMessageBlock(ev.player, mb)
    })

    ctx.command({
      name: 'portal',
      aliases: ['portals'],
      category: 'world',
      rank: 'AdvBuilder',
      usage: '/portal [exit|remove|list]',
      description: 'Creates a portal: mark the entrance, then go to the exit and type /portal exit',
      inGame: true,
      async run (player, args) {
        const sub = (args[0] || '').toLowerCase()
        const level = player.level
        if (sub === 'exit') {
          const pending = player.data['portals.pending']
          if (!pending) throw new CommandError('Mark an entrance first with /portal')
          const from = server.levels.get(pending.level)
          if (!from) throw new CommandError('The level of the entrance is not loaded anymore.')
          portalsOf(from)[pending.index] = { level: level.name, ...player.feetPos, yaw: player.yaw, pitch: player.pitch }
          from.dirty = true
          player.data['portals.pending'] = null
          return player.message(`&aPortal created! It leads here (${level.name}).`)
        }
        if (sub === 'remove' || sub === 'delete') {
          const m = await markOne(player, 'Remove portal')
          if (!m) return
          const i = level.index(m.x, m.y, m.z)
          if (!portalsOf(level)[i]) throw new CommandError('That block is not a portal.')
          delete portalsOf(level)[i]
          level.dirty = true
          return player.message('&aPortal removed.')
        }
        if (sub === 'list') {
          const list = Object.entries(portalsOf(level))
          if (!list.length) return player.message('&eNo portals in this level.')
          for (const [i, p] of list) {
            const at = level.unpack(Number(i))
            player.message(`&f(${at.x}, ${at.y}, ${at.z}) &7-> ${p.level} (${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`)
          }
          return
        }
        const m = await markOne(player, 'Portal entrance')
        if (!m) return
        player.data['portals.pending'] = { level: level.name, index: level.index(m.x, m.y, m.z) }
        player.message('&eEntrance marked. Now go to where the portal should lead (any level) and type &f/portal exit')
      }
    })

    ctx.command({
      name: 'mb',
      aliases: ['messageblock'],
      category: 'world',
      rank: 'AdvBuilder',
      usage: '/mb <message or /command> | /mb remove | /mb list',
      description: 'Makes a block show a message (or run a command) when touched or clicked',
      inGame: true,
      async run (player, args, { usage, raw }) {
        const level = player.level
        const sub = (args[0] || '').toLowerCase()
        if (!sub) return usage()
        if (sub === 'remove' || sub === 'delete') {
          const m = await markOne(player, 'Remove message block')
          if (!m) return
          const i = level.index(m.x, m.y, m.z)
          if (!mbsOf(level)[i]) throw new CommandError('That block has no message.')
          delete mbsOf(level)[i]
          level.dirty = true
          return player.message('&aMessage block removed.')
        }
        if (sub === 'list') {
          const list = Object.entries(mbsOf(level))
          if (!list.length) return player.message('&eNo message blocks in this level.')
          for (const [i, msg] of list.slice(0, 20)) {
            const at = level.unpack(Number(i))
            player.message(`&f(${at.x}, ${at.y}, ${at.z})&7: ${msg}`)
          }
          return
        }
        let msg = text.convertPercentCodes(raw)
        if (msg.startsWith('/') && player.permission < server.ranks.permissionOf('Operator')) {
          throw new CommandError('Only operators can create command blocks.')
        }
        if (msg.length > 250) throw new CommandError('Message too long (max 250 characters).')
        if (!msg.startsWith('/')) msg = text.sanitize(msg)
        const m = await markOne(player, 'Message block')
        if (!m) return
        mbsOf(level)[level.index(m.x, m.y, m.z)] = msg
        level.dirty = true
        player.message('&aMessage block created.')
      }
    })
  }
}
