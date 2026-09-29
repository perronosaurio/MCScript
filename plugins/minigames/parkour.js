'use strict'

// Parkour: step on the start block to start the timer, checkpoints save your progress,
// the finish block stops the timer. Best times are saved per level.

module.exports = function parkour (ctx) {
  const { server, CommandError } = ctx
  const records = ctx.loadData('parkour.json', {})
  const runs = new Map() // player -> { level, started, checkpoint, index }

  const courseOf = level => level.meta.parkour || null
  const same = (a, b) => a && b && a.x === b.x && a.y === b.y && a.z === b.z
  const feetBlocks = (pos) => {
    const x = Math.floor(pos.x / 32); const z = Math.floor(pos.z / 32)
    const y = Math.floor((pos.y - 51) / 32)
    return [{ x, y, z }, { x, y: y - 1, z }] // the block at the feet and the one below
  }
  const fmt = ms => `${(ms / 1000).toFixed(2)}s`
  const toCheckpoint = (player, run) => player.teleport(run.checkpoint.x + 0.5, run.checkpoint.y + 1, run.checkpoint.z + 0.5)

  ctx.on('playerMove', (ev) => {
    const player = ev.player
    const course = courseOf(player.level)
    if (!course) return
    const run = runs.get(player)
    const feet = feetBlocks(ev.to)

    if (course.fallY !== null && course.fallY !== undefined && run && feet[0].y < course.fallY) {
      toCheckpoint(player, run)
      player.message('&cYou fell! Back to your checkpoint.', 'status3')
      return
    }
    for (const b of feet) {
      if (same(b, course.start) && (!run || run.index > 0 || Date.now() - run.started > 1500)) {
        runs.set(player, { level: player.level.name, started: Date.now(), checkpoint: course.start, index: 0 })
        player.message('&aParkour started! Go!', 'announce')
        return
      }
      if (!run || run.level !== player.level.name) continue
      const cp = (course.checkpoints || []).findIndex(c => same(c, b))
      if (cp !== -1 && cp + 1 > run.index) {
        run.index = cp + 1
        run.checkpoint = course.checkpoints[cp]
        player.message(`&eCheckpoint ${cp + 1} reached (${fmt(Date.now() - run.started)})`, 'status3')
        return
      }
      if (same(b, course.finish)) {
        const time = Date.now() - run.started
        runs.delete(player)
        player.message('', 'status2')
        const levelRecords = records[player.level.name] || (records[player.level.name] = Object.create(null))
        const best = levelRecords[player.name.toLowerCase()]
        const top = Math.min(...Object.values(levelRecords), Infinity)
        if (!best || time < best) {
          levelRecords[player.name.toLowerCase()] = time
          ctx.saveData('parkour.json', records)
        }
        if (time < top) server.broadcast(`&6${player.coloredName}&6 set a new parkour record in ${player.level.name}: &f${fmt(time)}&6!`)
        else player.message(`&aFinished in &f${fmt(time)}&a${best && time >= best ? ` (your best: ${fmt(best)})` : ' - personal best!'}`)
        const eco = ctx.getPlugin('economy')
        if (eco && ctx.config.parkourReward && !best) { eco.add(player.name, ctx.config.parkourReward); player.message(`&a+${ctx.config.parkourReward} ${eco.currency} for your first finish!`) }
        return
      }
    }
  }, { priority: 'monitor' })

  ctx.setInterval(() => {
    for (const [player, run] of runs) {
      if (player.conn.closed || player.level.name !== run.level) { runs.delete(player); continue }
      player.message(`&eTime: &f${fmt(Date.now() - run.started)}`, 'status2')
    }
  }, 250)

  const mark = async (player, label) => {
    try {
      const [m] = await player.selectBlocks(1, label)
      return { x: m.x, y: m.y, z: m.z }
    } catch (err) { return null }
  }

  ctx.command({
    name: 'parkour',
    aliases: ['pk'],
    category: 'other',
    usage: '/parkour <top|cp|leave|setstart|setfinish|addcheckpoint|clearcheckpoints|fall <y|off>|remove>',
    description: 'Parkour courses with timer, checkpoints and records',
    help: ['Players: /parkour top, /parkour cp (back to checkpoint), /parkour leave', 'Operators: mark the blocks players step on with setstart, addcheckpoint, setfinish'],
    inGame: true,
    async run (player, args, { usage }) {
      const level = player.level
      const sub = (args[0] || 'top').toLowerCase()
      const isOp = player.permission >= server.ranks.permissionOf('Operator')
      const needOp = () => { if (!isOp) throw new CommandError('Only operators can set up parkour courses.') }
      const course = courseOf(level)

      switch (sub) {
        case 'top': {
          const list = Object.entries(records[level.name] || {}).sort((a, b) => a[1] - b[1]).slice(0, 10)
          if (!course) return player.message('&eThis level has no parkour course.')
          if (!list.length) return player.message('&eNo one has finished this course yet.')
          player.message(`&6Best times in ${level.name}:`)
          list.forEach(([name, ms], i) => player.message(`&f${i + 1}. ${(server.playerDB.get(name) || { name }).name} &7- ${fmt(ms)}`))
          return
        }
        case 'cp':
        case 'checkpoint': {
          const run = runs.get(player)
          if (!run) throw new CommandError('You are not running a course.')
          return toCheckpoint(player, run)
        }
        case 'leave':
          runs.delete(player)
          player.message('', 'status2')
          return player.message('&eYou left the course.')
        case 'setstart':
        case 'setfinish': {
          needOp()
          const b = await mark(player, sub === 'setstart' ? 'Parkour start' : 'Parkour finish')
          if (!b) return
          level.meta.parkour = { checkpoints: [], fallY: null, ...(course || {}), [sub === 'setstart' ? 'start' : 'finish']: b }
          level.dirty = true
          return player.message(`&a${sub === 'setstart' ? 'Start' : 'Finish'} set at ${b.x} ${b.y} ${b.z}.`)
        }
        case 'addcheckpoint': {
          needOp()
          if (!course) throw new CommandError('Set the start first.')
          const b = await mark(player, 'Parkour checkpoint')
          if (!b) return
          course.checkpoints.push(b)
          level.dirty = true
          return player.message(`&aCheckpoint ${course.checkpoints.length} added.`)
        }
        case 'clearcheckpoints':
          needOp()
          if (course) { course.checkpoints = []; level.dirty = true }
          return player.message('&aCheckpoints removed.')
        case 'fall': {
          needOp()
          if (!course) throw new CommandError('Set the start first.')
          course.fallY = args[1] === 'off' ? null : Number(args[1])
          if (course.fallY !== null && !Number.isInteger(course.fallY)) return usage()
          level.dirty = true
          return player.message(course.fallY === null ? '&aFall detection off.' : `&aPlayers below y=${course.fallY} go back to their checkpoint.`)
        }
        case 'remove':
          needOp()
          delete level.meta.parkour
          level.dirty = true
          return player.message('&aParkour course removed from this level.')
        default:
          return usage()
      }
    }
  })
}
