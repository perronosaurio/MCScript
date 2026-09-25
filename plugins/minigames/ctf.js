'use strict'

// Capture the Flag: walk into the enemy flag (a wool block) to take it and bring it to your own flag.
// Click an enemy (CPE PlayerClick) near you to tag them: they respawn and drop the flag.

const { Round, distance } = require('./round')
const gameCommand = require('./game-command')
const { TEAMS, assignTeams, smallerTeam, teamOf, spawnAt, positionOf } = require('./teams')

module.exports = function ctf (ctx) {
  const { server, CommandError } = ctx
  const settings = () => ({ captures: 3, timeLimitMinutes: 10, tagDistance: 4, ...ctx.config.ctf })

  const game = gameCommand(ctx, {
    name: 'ctf',
    aliases: ['capturetheflag'],
    title: 'Capture the Flag',
    metaKey: 'ctf',
    setupHelp: ['/ctf setflag <red|blue> - mark the flag block', '/ctf setspawn <red|blue> - team spawn at your position'],
    setup: {
      async setflag (player, args, meta) {
        const team = (args[0] || '').toLowerCase()
        if (!TEAMS[team]) throw new CommandError('Team must be red or blue.')
        let marks
        try { marks = await player.selectBlocks(1, `${TEAMS[team].name} flag`) } catch (err) { return }
        const { x, y, z } = marks[0]
        meta.flags = { ...(meta.flags || {}), [team]: { x, y, z } }
        player.level.setBlock(x, y, z, TEAMS[team].flagBlock)
        player.level.dirty = true
        player.message(`&a${TEAMS[team].color}${TEAMS[team].name}&a flag set.`)
      },
      setspawn (player, args, meta) {
        const team = (args[0] || '').toLowerCase()
        if (!TEAMS[team]) throw new CommandError('Team must be red or blue.')
        meta.spawns = { ...(meta.spawns || {}), [team]: positionOf(player) }
        player.level.dirty = true
        player.message(`&aSpawn of the ${TEAMS[team].color}${TEAMS[team].name}&a team set.`)
      }
    },
    createRound (level) {
      const meta = () => level.meta.ctf || {}
      let score = { red: 0, blue: 0 }
      let carriers = { red: null, blue: null } // team whose flag is carried -> player
      let endsAt = 0
      const round = new Round(ctx, {
        id: 'ctf',
        title: 'Capture the Flag',
        level,
        minPlayers: 2,
        onStart () {
          const flags = meta().flags || {}
          if (!flags.red || !flags.blue) { round.end(null, 'The flags are not set up (/ctf setflag)'); return }
          score = { red: 0, blue: 0 }
          carriers = { red: null, blue: null }
          endsAt = Date.now() + settings().timeLimitMinutes * 60000
          placeFlag('red'); placeFlag('blue')
          assignTeams(round.players)
          for (const p of round.players) setup(p)
          round.repeat(tick, 200)
          round.repeat(() => {
            round.status('status1', `${TEAMS.red.color}Red ${score.red} &f- ${TEAMS.blue.color}${score.blue} Blue`)
            round.status('status2', `&eTime left: &f${Math.ceil(Math.max(0, endsAt - Date.now()) / 1000)}s`)
            if (Date.now() > endsAt) finish()
          }, 1000)
        },
        onLateJoin (p) { p.data.team = smallerTeam(round.players); setup(p) },
        onLeave (p) { dropFlag(p) }
      })

      const flagPos = team => (meta().flags || {})[team]
      const placeFlag = team => { const f = flagPos(team); level.setBlock(f.x, f.y, f.z, TEAMS[team].flagBlock) }
      const enemy = team => team === 'red' ? 'blue' : 'red'

      function setup (p) {
        const t = teamOf(p)
        p.message(`&eYou are in the ${t.color}${t.name}&e team! Bring the enemy flag to yours.`)
        spawnAt(p, (meta().spawns || {})[p.data.team], level)
        server.tabList.update(p)
      }

      function dropFlag (p) {
        for (const team of ['red', 'blue']) {
          if (carriers[team] === p) {
            carriers[team] = null
            placeFlag(team)
            round.broadcast(`${TEAMS[team].color}The ${TEAMS[team].name} flag&e was returned.`)
          }
        }
      }

      function tick () {
        if (!round.running) return
        for (const p of round.players) {
          const mine = p.data.team
          if (!mine) continue
          const other = enemy(mine)
          const center = f => ({ x: (f.x + 0.5) * 32, y: f.y * 32 + 51, z: (f.z + 0.5) * 32 })
          // take the enemy flag
          const ef = flagPos(other)
          if (!carriers[other] && distance(p.pos, center(ef)) < 1.8) {
            carriers[other] = p
            level.setBlock(ef.x, ef.y, ef.z, 0)
            round.broadcast(`${TEAMS[mine].color}${p.name}&e took the ${TEAMS[other].color}${TEAMS[other].name} flag&e!`, 'announce')
          }
          // capture at our own flag (it must be at home)
          const of = flagPos(mine)
          if (carriers[other] === p && !carriers[mine] && distance(p.pos, center(of)) < 1.8) {
            carriers[other] = null
            placeFlag(other)
            score[mine]++
            round.broadcast(`${TEAMS[mine].color}${p.name}&e captured the flag! (${score[mine]}/${settings().captures})`, 'announce')
            if (score[mine] >= settings().captures) return finish()
          }
        }
      }

      function finish () {
        const winner = score.red === score.blue ? null : score.red > score.blue ? 'red' : 'blue'
        round.end(winner ? [...round.players].filter(p => p.data.team === winner) : [], winner ? `${TEAMS[winner].name} team wins ${score.red}-${score.blue}` : `Draw ${score.red}-${score.blue}`)
      }

      round.tag = (attacker, victim) => {
        if (!round.running || !round.has(victim) || victim.data.team === attacker.data.team) return
        if (distance(attacker.pos, victim.pos) > settings().tagDistance) return
        dropFlag(victim)
        spawnAt(victim, (meta().spawns || {})[victim.data.team], level)
        round.broadcast(`${teamOf(attacker).color}${attacker.name}&e tagged ${teamOf(victim).color}${victim.name}`)
      }

      return round
    }
  })

  ctx.on('playerClick', (ev) => {
    if (ev.button !== 'left' || ev.action !== 'press' || ev.targetEntity < 0) return
    const r = game.roundOf(ev.player)
    if (!r || r.id !== 'ctf') return
    const victim = [...r.players].find(p => p.id === ev.targetEntity)
    if (victim) r.tag(ev.player, victim)
  })

  // flags can't be broken by hand during a game
  ctx.on('blockChange', (ev) => {
    const r = game.roundOf(ev.player)
    if (!r || r.id !== 'ctf' || !r.running) return
    const flags = ev.level.meta.ctf && ev.level.meta.ctf.flags
    if (flags && Object.values(flags).some(f => f.x === ev.x && f.y === ev.y && f.z === ev.z)) ev.cancel()
  }, { priority: 'high' })

  ctx.on('tabListEntry', (ev) => {
    const t = teamOf(ev.player)
    if (t && game.roundOf(ev.player)) { ev.groupName = `${t.color}Team ${t.name}`; ev.listName = t.color + ev.player.name }
  })

  return game
}
