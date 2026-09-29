'use strict'

// Zombie Survival: one player starts as a zombie; zombies infect humans by touching them.
// Humans win if anyone survives until the time runs out.

const { Round, distance, randomItem } = require('./round')
const gameCommand = require('./game-command')

module.exports = function zombie (ctx) {
  const { server } = ctx
  const settings = () => ({ minutes: 5, touchDistance: 1.2, ...ctx.config.zombie })

  const game = gameCommand(ctx, {
    name: 'zombie',
    aliases: ['zs', 'zombiesurvival', 'infection'],
    title: 'Zombie Survival',
    metaKey: 'zombie',
    createRound (level) {
      let endsAt = 0
      let firstZombies = []
      const round = new Round(ctx, {
        id: 'zombie',
        title: 'Zombie Survival',
        level,
        minPlayers: 2,
        countdown: 15,
        onStart () {
          endsAt = Date.now() + settings().minutes * 60000
          for (const p of round.players) p.data.team = 'human'
          const count = Math.max(1, Math.floor(round.players.size / 6))
          firstZombies = []
          for (let i = 0; i < count; i++) {
            const pick = randomItem([...round.players].filter(p => p.data.team === 'human'))
            infect(pick, null)
            firstZombies.push(pick)
          }
          const s = level.spawn
          for (const p of round.players) p.teleport(s.x, s.y, s.z)
          round.repeat(tick, 150)
          round.repeat(() => {
            const humans = [...round.players].filter(p => p.data.team === 'human').length
            round.status('status1', `&aHumans: &f${humans} &c Zombies: &f${round.players.size - humans}`)
            round.status('status2', `&eSurvive: &f${Math.ceil(Math.max(0, endsAt - Date.now()) / 1000)}s`)
            if (Date.now() > endsAt) {
              const alive = [...round.players].filter(p => p.data.team === 'human')
              round.end(alive, `${alive.length} human(s) survived!`)
            }
          }, 1000)
        },
        onLateJoin (p) { infect(p, null) },
        onLeave () { checkEnd() }
      })

      function infect (p, by) {
        p.data.team = 'zombie'
        p.setModel('zombie', false)
        if (by) round.broadcast(`&c${by.name} infected ${p.name}!`)
        else p.message('&cYou are a zombie! Touch the humans to infect them.', 'announce')
        server.tabList.update(p)
      }

      function checkEnd () {
        if (!round.running) return
        const humans = [...round.players].filter(p => p.data.team === 'human')
        if (!humans.length) round.end([...round.players].filter(p => p.data.team === 'zombie'), 'The zombies infected everyone!')
      }

      function tick () {
        if (!round.running) return
        const zombies = [...round.players].filter(p => p.data.team === 'zombie')
        for (const human of [...round.players].filter(p => p.data.team === 'human')) {
          const z = zombies.find(z => distance(z.pos, human.pos) < settings().touchDistance)
          if (z) infect(human, z)
        }
        checkEnd()
      }

      round.firstZombies = () => firstZombies
      return round
    }
  })

  ctx.on('tabListEntry', (ev) => {
    const team = ev.player.data.team
    if (!game.roundOf(ev.player)) return
    if (team === 'zombie') { ev.groupName = '&cZombies'; ev.listName = '&c' + ev.player.name }
    if (team === 'human') { ev.groupName = '&aHumans'; ev.listName = '&a' + ev.player.name }
  })

  return game
}
