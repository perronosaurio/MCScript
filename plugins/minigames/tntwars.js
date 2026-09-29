'use strict'

// TNT Wars: two teams. Right click a block (or place TNT) to drop TNT; it explodes after a few
// seconds and knocks out enemies nearby. First team to the score limit wins. The arena is restored.

const { Round, distance } = require('./round')
const gameCommand = require('./game-command')
const { TEAMS, assignTeams, smallerTeam, teamOf, spawnAt, positionOf } = require('./teams')

const TNT = 46
const FUSE_MS = 2500
const COOLDOWN_MS = 1500

module.exports = function tntwars (ctx) {
  const { server } = ctx
  const settings = () => ({ scoreLimit: 10, radius: 3, timeLimitMinutes: 10, ...ctx.config.tntwars })

  const game = gameCommand(ctx, {
    name: 'tntwars',
    aliases: ['tw'],
    title: 'TNT Wars',
    metaKey: 'tntwars',
    setupHelp: ['/tntwars setspawn <red|blue> - team spawn at your position'],
    setup: {
      setspawn (player, args, meta) {
        const team = (args[0] || '').toLowerCase()
        if (!TEAMS[team]) throw new ctx.CommandError('Team must be red or blue.')
        meta.spawns = { ...(meta.spawns || {}), [team]: positionOf(player) }
        player.level.dirty = true
        player.message(`&aSpawn of the ${TEAMS[team].color}${TEAMS[team].name}&a team set.`)
      }
    },
    createRound (level) {
      const meta = () => level.meta.tntwars || {}
      let score = { red: 0, blue: 0 }
      let endsAt = 0
      const lastDrop = new Map()
      const round = new Round(ctx, {
        id: 'tntwars',
        title: 'TNT Wars',
        level,
        minPlayers: 2,
        onStart () {
          score = { red: 0, blue: 0 }
          endsAt = Date.now() + settings().timeLimitMinutes * 60000
          assignTeams(round.players)
          for (const p of round.players) setup(p)
          round.repeat(() => {
            const left = Math.max(0, endsAt - Date.now())
            round.status('status1', `${TEAMS.red.color}Red ${score.red} &f- ${TEAMS.blue.color}${score.blue} Blue`)
            round.status('status2', `&eTime left: &f${Math.ceil(left / 1000)}s`)
            if (!left) finish()
          }, 1000)
        },
        onLateJoin (p) { p.data.team = smallerTeam(round.players); setup(p) }
      })

      function setup (p) {
        const t = teamOf(p)
        p.message(`&eYou are in the ${t.color}${t.name}&e team! Right click blocks to drop TNT.`)
        spawnAt(p, (meta().spawns || {})[p.data.team], level)
        p.holdBlock(TNT, false)
        server.tabList.update(p)
      }

      function finish () {
        const winner = score.red === score.blue ? null : score.red > score.blue ? 'red' : 'blue'
        round.end(winner ? [...round.players].filter(p => p.data.team === winner) : [], winner ? `${TEAMS[winner].name} team wins ${score.red}-${score.blue}` : `Draw ${score.red}-${score.blue}`)
      }

      round.drop = (player, x, y, z) => {
        if (!round.running || !round.has(player)) return false
        const now = Date.now()
        if ((lastDrop.get(player) || 0) > now - COOLDOWN_MS) return true
        if (!level.inBounds(x, y, z) || level.getBlock(x, y, z) !== 0) return true
        lastDrop.set(player, now)
        level.setBlock(x, y, z, TNT)
        round.later(() => explode(player, x, y, z), FUSE_MS)
        return true
      }

      function explode (thrower, x, y, z) {
        if (!round.running) return
        if (level.getBlock(x, y, z) === TNT) level.setBlock(x, y, z, 0)
        const radius = settings().radius
        const physics = ctx.getPlugin('physics')
        if (physics && physics.explode) physics.explode(level, x, y, z, radius)
        else {
          const changes = []
          for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
              for (let dz = -radius; dz <= radius; dz++) {
                if (dx * dx + dy * dy + dz * dz > radius * radius) continue
                const b = level.getBlock(x + dx, y + dy, z + dz)
                if (b !== 7 && b !== 49) changes.push([x + dx, y + dy, z + dz, 0])
              }
            }
          }
          level.setBlocks(changes)
        }
        const center = { x: (x + 0.5) * 32, y: (y + 0.5) * 32 + 51, z: (z + 0.5) * 32 }
        for (const victim of round.players) {
          if (victim.data.team === thrower.data.team && victim !== thrower) continue
          if (distance(victim.pos, center) > radius + 1) continue
          spawnAt(victim, (meta().spawns || {})[victim.data.team], level)
          if (victim === thrower) { victim.message('&cYou blew yourself up!'); continue }
          score[thrower.data.team]++
          round.broadcast(`${teamOf(thrower).color}${thrower.name}&e blew up ${teamOf(victim).color}${victim.name}`)
        }
        if (score.red >= settings().scoreLimit || score.blue >= settings().scoreLimit) finish()
      }

      return round
    }
  })

  const roundOfPlayer = p => game.roundOf(p)

  // right click with PlayerClick drops TNT on the clicked face
  ctx.on('playerClick', (ev) => {
    if (ev.button !== 'right' || ev.action !== 'press' || !ev.target) return
    const r = roundOfPlayer(ev.player)
    if (!r || r.id !== 'tntwars') return
    const face = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][ev.target.face] || [0, 1, 0]
    r.drop(ev.player, ev.target.x + face[0], ev.target.y + face[1], ev.target.z + face[2])
  })

  // players in a running game may "place" TNT whatever their rank; the block itself is never placed
  ctx.on('blockPermission', (ev) => {
    const r = roundOfPlayer(ev.player)
    if (r && r.id === 'tntwars' && r.running) { ev.allowed = true; ev.message = null }
  })

  // placing TNT (or anything while holding TNT, for clients without PlayerClick) also works
  ctx.on('blockChange', (ev) => {
    const r = roundOfPlayer(ev.player)
    if (!r || r.id !== 'tntwars' || !r.running) return
    ev.cancel()
    if (ev.placing && (ev.block === TNT || !ev.player.supports('PlayerClick'))) r.drop(ev.player, ev.x, ev.y, ev.z)
  }, { priority: 'high' })

  ctx.on('tabListEntry', (ev) => {
    const t = teamOf(ev.player)
    if (t && roundOfPlayer(ev.player)) { ev.groupName = `${t.color}Team ${t.name}`; ev.listName = t.color + ev.player.name }
  })

  return game
}
