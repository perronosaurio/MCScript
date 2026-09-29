'use strict'

// Protected areas inside a level. Only players with enough rank (or on the zone's whitelist) can build there.
// Zones are stored inside the level file (level.meta.zones), so they travel with the map.

const COLORS = [[255, 80, 80], [80, 255, 80], [80, 160, 255], [255, 220, 60], [220, 90, 255], [60, 230, 230]]
const SELECTION_BASE = 100

module.exports = {
  name: 'zones',
  version: '1.0.0',
  description: 'Protected building zones',
  author: 'MCScript',

  load (ctx) {
    const { server, CommandError } = ctx

    const zonesOf = level => (level.meta.zones = level.meta.zones || [])

    const zonesAt = (level, x, y, z) => zonesOf(level).filter(zn =>
      x >= zn.x1 && x <= zn.x2 && y >= zn.y1 && y <= zn.y2 && z >= zn.z1 && z <= zn.z2)

    const canBuildIn = (player, zone) => {
      if (player.isConsole) return true
      if (zone.owners && zone.owners.includes(player.name.toLowerCase())) return true
      return player.permission >= server.ranks.permissionOf(zone.rank)
    }

    const canBuild = (player, level, x, y, z) => zonesAt(level, x, y, z).every(zn => canBuildIn(player, zn))

    const show = (player, level) => {
      zonesOf(level).forEach((zn, i) => {
        const c = COLORS[i % COLORS.length]
        player.showSelection(SELECTION_BASE + (i % 100), zn.name, { x: zn.x1, y: zn.y1, z: zn.z1 }, { x: zn.x2, y: zn.y2, z: zn.z2 }, [...c, 60])
      })
    }
    const hide = (player, level) => zonesOf(level).forEach((zn, i) => player.hideSelection(SELECTION_BASE + (i % 100)))

    ctx.on('blockChange', (ev) => {
      const blocked = zonesAt(ev.level, ev.x, ev.y, ev.z).find(zn => !canBuildIn(ev.player, zn))
      if (blocked) ev.cancel(`&cThis area is protected by zone &f${blocked.name}&c.`)
    }, { priority: 'high' })

    ctx.on('drawOperation', (ev) => {
      if (!zonesOf(ev.level).length) return
      const before = ev.changes.length
      ev.changes = ev.changes.filter(([x, y, z]) => canBuild(ev.player, ev.level, x, y, z))
      if (ev.changes.length < before) ev.player.message(`&7${before - ev.changes.length} blocks were inside protected zones.`)
    }, { priority: 'high' })

    ctx.on('playerSpawn', ({ player }) => { if (player.data['zones.show']) show(player, player.level) })

    ctx.command({
      name: 'zone',
      aliases: ['zones', 'oz'],
      category: 'building',
      rank: 'Guest',
      usage: '/zone <add|delete|list|show|hide|check|allow|disallow> ...',
      description: 'Protects areas of the level',
      help: [
        '/zone add <name> [rank] - mark two corners; only that rank+ can build inside (default Operator)',
        '/zone allow <name> <player> / disallow - lets a player build even without the rank',
        '/zone delete <name>, /zone list, /zone show, /zone hide, /zone check'
      ],
      inGame: true,
      async run (player, args, { usage }) {
        const level = player.level
        const zones = zonesOf(level)
        const sub = (args[0] || '').toLowerCase()
        const name = (args[1] || '').toLowerCase()
        const isOp = player.permission >= server.ranks.permissionOf('Operator')
        const findZone = () => {
          const zn = zones.find(z => z.name === name)
          if (!zn) throw new CommandError(`No zone named "${name}" in this level.`)
          return zn
        }

        switch (sub) {
          case 'add':
          case 'create': {
            if (!isOp) throw new CommandError('Only operators can create zones.')
            if (!/^[a-z0-9_-]{1,32}$/.test(name)) return usage()
            if (zones.some(z => z.name === name)) throw new CommandError('A zone with that name already exists.')
            const rank = server.ranks.get(args[2] || 'Operator')
            if (!rank) throw new CommandError('Unknown rank.')
            let marks
            try { marks = await player.selectBlocks(2, `Zone ${name}`) } catch (err) { return }
            const [a, b] = marks
            zones.push({
              name,
              rank: rank.name,
              owners: [],
              createdBy: player.name,
              x1: Math.min(a.x, b.x),
              y1: Math.min(a.y, b.y),
              z1: Math.min(a.z, b.z),
              x2: Math.max(a.x, b.x),
              y2: Math.max(a.y, b.y),
              z2: Math.max(a.z, b.z)
            })
            level.dirty = true
            player.message(`&aZone &f${name}&a created. ${rank.color}${rank.name}&a+ can build inside.`)
            if (player.data['zones.show']) show(player, level)
            break
          }
          case 'delete':
          case 'remove':
          case 'del': {
            if (!isOp) throw new CommandError('Only operators can delete zones.')
            const zn = findZone()
            hide(player, level)
            zones.splice(zones.indexOf(zn), 1)
            level.dirty = true
            if (player.data['zones.show']) show(player, level)
            player.message(`&aZone ${zn.name} deleted.`)
            break
          }
          case 'allow':
          case 'disallow': {
            const zn = findZone()
            if (!isOp && !(zn.owners || []).includes(player.name.toLowerCase())) throw new CommandError('Only operators or zone members can change members.')
            const who = (args[2] || '').toLowerCase()
            if (!who) return usage()
            zn.owners = zn.owners || []
            if (sub === 'allow' && !zn.owners.includes(who)) zn.owners.push(who)
            if (sub === 'disallow') zn.owners = zn.owners.filter(o => o !== who)
            level.dirty = true
            player.message(`&a${who} ${sub === 'allow' ? 'can now' : 'can no longer'} build in ${zn.name}.`)
            break
          }
          case 'list': {
            if (!zones.length) return player.message('&eThis level has no zones.')
            for (const zn of zones) {
              const rank = server.ranks.get(zn.rank)
              player.message(`&f${zn.name}&7: (${zn.x1},${zn.y1},${zn.z1}) to (${zn.x2},${zn.y2},${zn.z2}), ${rank ? rank.color + rank.name : zn.rank}&7+${zn.owners && zn.owners.length ? ', members: ' + zn.owners.join(', ') : ''}`)
            }
            break
          }
          case 'show':
            if (!player.supports('SelectionCuboid')) throw new CommandError('Your client can\'t display zones.')
            player.data['zones.show'] = true
            show(player, level)
            player.message('&eShowing zones. &7(/zone hide)')
            break
          case 'hide':
            player.data['zones.show'] = false
            hide(player, level)
            player.message('&eZones hidden.')
            break
          case 'check': {
            let marks
            try { marks = await player.selectBlocks(1, 'Zone check') } catch (err) { return }
            const { x, y, z } = marks[0]
            const found = zonesAt(level, x, y, z)
            player.message(found.length ? `&eBlock is in: &f${found.map(zn => zn.name).join(', ')}&e. You ${found.every(zn => canBuildIn(player, zn)) ? '&acan' : '&ccannot'}&e build here.` : '&eThat block is not in any zone.')
            break
          }
          default:
            return usage()
        }
      }
    })

    module.exports.api = { zonesAt, canBuild }
  }
}
