'use strict'

// Small extras for showing a server off:
//   - a HUD: the server name and the world in the top right corner, players online (and coins) bottom right
//   - ambient particles at the spots listed in a level's meta.ambient ([{ x, y, z, effect, every }])
//   - bounce pads and effect pads: custom blocks that launch players or show particles when stepped on
//   - /tour: a guided flight through the stops saved in the main level (/tour add to make one)

const STEPS_PER_SECOND = 20

module.exports = {
  name: 'extras',
  version: '1.0.0',
  description: 'HUD, ambient particles, bounce and effect pads, and /tour',
  author: 'MCScript',

  defaultConfig: {
    hud: false, // minigames also use these lines; their scores win while someone is playing
    hudServerName: '', // empty: the server name from config/server.json
    ambientParticles: true,
    bouncePad: 0, // block id that launches players up (0 = none)
    bouncePower: 4.5,
    effectPad: 0, // block id that shows a particle effect (0 = none); level.meta.effectPads picks one per pad
    effectPadEffect: 'magic',
    tourSeconds: 4
  },

  load (ctx) {
    const { server, config, CommandError } = ctx
    const economy = () => { try { return ctx.getPlugin('economy') } catch (err) { return null } }

    // ---- HUD
    const hud = (player) => {
      if (!config.hud || !player.spawned || !player.level || player.conn.closed || player.data.team) return
      player.message(config.hudServerName || server.config.name, 'status1')
      player.message(`&eWorld: &f${player.level.name}`, 'status2')
      player.message(`&7${server.online.filter(p => !p.hidden).length} online`, 'bottom1')
      const eco = economy()
      if (eco && eco.balance && player.record) player.message(`&e${eco.balance(player.name)} &7${eco.currency || 'coins'}`, 'bottom2')
    }
    const hudAll = () => server.online.forEach(hud)
    ctx.on('playerSpawn', ({ player }) => ctx.setTimeout(() => hud(player), 500), { priority: 'monitor' })
    ctx.on('playerJoin', () => ctx.setTimeout(hudAll, 1000), { priority: 'monitor' })
    ctx.on('playerLeave', () => ctx.setTimeout(hudAll, 1000), { priority: 'monitor' })
    ctx.setInterval(hudAll, 15000)

    // ---- ambient particles, only in levels someone is looking at
    let tick = 0
    ctx.setInterval(() => {
      if (!config.ambientParticles) return
      tick++
      const watched = new Set(server.online.filter(p => p.spawned).map(p => p.level))
      for (const level of watched) {
        for (const a of level.meta.ambient || []) {
          if (tick % (a.every || 2) !== 0 || !server.particleEffects.has(a.effect)) continue
          server.spawnParticles(level, a.effect, a.x, a.y, a.z)
        }
      }
    }, 1000)

    // ---- pads
    ctx.on('playerMove', ({ player, to }) => {
      if (!config.bouncePad && !config.effectPad) return
      const level = player.level
      const x = Math.floor(to.x / 32); const y = Math.floor((to.y - 51) / 32); const z = Math.floor(to.z / 32)
      if (!level.inBounds(x, y, z)) return
      const block = level.getBlock(x, y, z)
      if (!block || (block !== config.bouncePad && block !== config.effectPad)) return
      const now = Date.now()
      if ((player.data['extras.pad'] || 0) > now) return
      if (block === config.bouncePad) {
        player.data['extras.pad'] = now + 700
        player.setVelocity(0, config.bouncePower, 0, { addX: true, addZ: true })
        if (server.particleEffects.has('sparkle')) server.spawnParticles(level, 'sparkle', x + 0.5, y + 0.3, z + 0.5)
      } else {
        player.data['extras.pad'] = now + 1500
        const effect = (level.meta.effectPads || {})[`${x},${y},${z}`] || config.effectPadEffect
        if (server.particleEffects.has(effect)) server.spawnParticles(level, effect, x + 0.5, y + 1.2, z + 0.5)
      }
    })

    // ---- /tour
    const touring = new Map() // player -> { level, timer }
    const stopsOf = level => level.meta.tour || []

    function endTour (player, message) {
      const t = touring.get(player)
      if (!t) return
      ctx.clearTimer(t.timer)
      touring.delete(player)
      if (player.conn.closed) return
      player.setCinematic({ barSize: 0 })
      player.restoreHacks()
      if (player.spawned && player.level === t.level) {
        const s = t.level.spawn
        player.setVelocity(0, 0, 0)
        player.teleport(s.x, s.y, s.z, s.yaw, s.pitch)
      }
      if (message) player.message(message)
    }

    function startTour (player, level) {
      const stops = stopsOf(level)
      const t = { level, timer: null }
      touring.set(player, t)
      player.setCinematic({ barSize: 0.12, hideCrosshair: true, hideHand: true, hideHotbar: true })
      // flying and noclip on, so the camera never falls or gets stuck between stops
      player.setHacks({ flying: true, noClip: true, speeding: false, spawnControl: false, thirdPerson: false })
      const steps = Math.max(1, Math.round(config.tourSeconds * STEPS_PER_SECOND))
      const angle = (a, b, f) => { const d = ((b - a + 384) % 256) - 128; return Math.round(a + d * f) & 255 }
      const pitchOf = p => p > 127 ? p - 256 : p
      const show = (i) => {
        if (stops[i][5]) player.message(stops[i][5], 'announce')
        player.message(`&7Stop ${i + 1} of ${stops.length} - /tour stop to end`, 'smallAnnounce')
      }
      let step = 0
      show(0)
      t.timer = ctx.setInterval(() => {
        if (!touring.has(player) || !player.spawned || player.level !== level) return endTour(player)
        const i = Math.floor(step / steps)
        if (i >= stops.length - 1) return endTour(player, '&eThat\'s the tour!')
        // hold still for a bit at each stop, then glide to the next one
        const f = (step % steps) / steps
        const move = Math.max(0, f - 0.4) / 0.6
        const e = move * move * (3 - 2 * move)
        const [x1, y1, z1, yaw1, p1] = stops[i]; const [x2, y2, z2, yaw2, p2] = stops[i + 1]
        // no speed left over from the last step: without this the client keeps falling between updates
        player.setVelocity(0, 0, 0)
        player.teleport(x1 + (x2 - x1) * e, y1 + (y2 - y1) * e, z1 + (z2 - z1) * e, angle(yaw1, yaw2, e), Math.round(pitchOf(p1) + (pitchOf(p2) - pitchOf(p1)) * e) & 255)
        step++
        if (step % steps === 0) show(Math.floor(step / steps))
      }, 1000 / STEPS_PER_SECOND)
    }

    ctx.on('playerChangeLevel', ({ player }) => { if (touring.has(player)) endTour(player) }, { priority: 'monitor' })
    ctx.on('playerLeave', ({ player }) => { const t = touring.get(player); if (t) { ctx.clearTimer(t.timer); touring.delete(player) } })
    ctx.onUnload(() => { for (const player of [...touring.keys()]) endTour(player) })

    ctx.command({
      name: 'tour',
      category: 'other',
      usage: '/tour [stop] | /tour add [text] | /tour remove <number> | /tour list | /tour clear',
      description: 'A guided flight around the main level',
      help: ['/tour - start the tour; /tour stop - end it', 'Admins: stand where a stop should be, look where the camera should look, and /tour add <text>'],
      inGame: true,
      run (player, args) {
        const sub = (args[0] || '').toLowerCase()
        const main = server.levels.main
        const isAdmin = player.permission >= server.ranks.permissionOf('Admin')
        const needAdmin = () => { if (!isAdmin) throw new CommandError('Only admins can change the tour.') }
        if (sub === 'stop') return touring.has(player) ? endTour(player, '&eTour stopped.') : player.message('&eYou are not on the tour.')
        if (sub === 'add') {
          needAdmin()
          if (player.level !== main) throw new CommandError(`The tour is in the main level (${main.name}).`)
          const p = player.feetPos
          const stop = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10, player.yaw, player.pitch, args.slice(1).join(' ')]
          main.meta.tour = [...stopsOf(main), stop]
          main.dirty = true
          return player.message(`&aStop ${main.meta.tour.length} added.`)
        }
        if (sub === 'remove') {
          needAdmin()
          const n = Number(args[1])
          const stops = stopsOf(main)
          if (!Number.isInteger(n) || n < 1 || n > stops.length) throw new CommandError(`Give a stop number from 1 to ${stops.length}.`)
          main.meta.tour = stops.filter((_, i) => i !== n - 1)
          main.dirty = true
          return player.message(`&aStop ${n} removed.`)
        }
        if (sub === 'clear') {
          needAdmin()
          delete main.meta.tour
          main.dirty = true
          return player.message('&aThe tour was removed.')
        }
        if (sub === 'list') {
          const stops = stopsOf(main)
          if (!stops.length) return player.message('&eThere is no tour yet.')
          stops.forEach((s, i) => player.message(`&f${i + 1}. &7(${Math.floor(s[0])}, ${Math.floor(s[1])}, ${Math.floor(s[2])}) &f${s[5] || ''}`))
          return
        }
        if (touring.has(player)) throw new CommandError('You are already on the tour. /tour stop ends it.')
        if (stopsOf(main).length < 2) throw new CommandError('This server has no tour.' + (isAdmin ? ' Make one with /tour add <text>.' : ''))
        if (player.level === main) return startTour(player, main)
        if (!player.changeLevel(main)) return
        // the level is still loading on the client: start once it is there
        ctx.setTimeout(() => { if (player.spawned && player.level === main) startTour(player, main) }, 1500)
      }
    })
  }
}
