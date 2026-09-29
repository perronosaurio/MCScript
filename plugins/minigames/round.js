'use strict'

// Shared logic for round based games: joining, countdown, teams, scoreboard (CPE MessageTypes),
// hacks control and restoring the arena when the round ends.

class Round {
  constructor (ctx, { id, title, level, minPlayers = 2, countdown = 10, onStart, onEnd, onLeave, onLateJoin }) {
    this.ctx = ctx
    this.server = ctx.server
    this.id = id
    this.title = title
    this.level = level
    this.minPlayers = minPlayers
    this.countdownSeconds = countdown
    this.players = new Set()
    this.state = 'waiting' // waiting -> countdown -> running
    this.hooks = { onStart, onEnd, onLeave, onLateJoin }
    this.timers = []
    this.snapshot = null
  }

  get running () { return this.state === 'running' }

  has (player) { return this.players.has(player) }

  broadcast (msg, type = 'chat') {
    for (const p of this.players) p.message(msg, type)
  }

  status (line, text) {
    for (const p of this.players) p.message(text, line)
  }

  join (player) {
    if (this.players.has(player)) return player.message(`&eYou are already in ${this.title}.`)
    if (player.level !== this.level && !player.changeLevel(this.level)) return
    this.players.add(player)
    this.broadcast(`&a+ ${player.coloredName}&e joined ${this.title} (${this.players.size})`)
    if (this.running) {
      player.setHacks({ flying: false, noClip: false, speeding: false, spawnControl: false, thirdPerson: true })
      if (this.hooks.onLateJoin) this.hooks.onLateJoin(player)
    } else if (this.state === 'waiting' && this.players.size >= this.minPlayers) {
      this.startCountdown()
    } else if (this.state === 'waiting') {
      player.message(`&eWaiting for ${this.minPlayers - this.players.size} more player(s)...`, 'status1')
    }
  }

  leave (player, quiet = false) {
    if (!this.players.delete(player)) return
    this._resetPlayer(player)
    if (!quiet) this.broadcast(`&c- ${player.coloredName}&e left ${this.title}`)
    if (this.hooks.onLeave) this.hooks.onLeave(player)
    if (this.players.size < this.minPlayers && this.state !== 'waiting') {
      this.end(null, 'Not enough players')
    }
  }

  startCountdown () {
    this.state = 'countdown'
    let left = this.countdownSeconds
    const tick = () => {
      if (this.state !== 'countdown') return
      if (this.players.size < this.minPlayers) { this.state = 'waiting'; this.status('status1', ''); return }
      if (left <= 0) return this.start()
      this.status('status1', `&e${this.title} starts in &f${left}`)
      if (left <= 3) this.broadcast(`&e${left}...`, 'announce')
      left--
      this.later(tick, 1000)
    }
    tick()
  }

  start () {
    this.state = 'running'
    this.snapshot = { blocks: Buffer.from(this.level.blocks), upper: this.level.upper ? Buffer.from(this.level.upper) : null }
    this.broadcast(`&a${this.title} has started!`, 'announce')
    for (const p of this.players) p.setHacks({ flying: false, noClip: false, speeding: false, spawnControl: false, thirdPerson: true })
    if (this.hooks.onStart) this.hooks.onStart()
  }

  // winners: a list of players (or null); reward from the economy plugin if installed
  end (winners, reason) {
    if (!this.snapshot) {
      // never started: just send everyone home
      for (const p of this.players) this._resetPlayer(p)
      this.players.clear()
      this.clearTimers()
      this.state = 'waiting'
      return
    }
    const eco = this.ctx.getPlugin('economy')
    const reward = this.ctx.config.reward || 0
    if (reason) this.broadcast(`&e${this.title} ended: &f${reason}`)
    if (winners && winners.length) {
      this.broadcast(`&aWinners: &f${winners.map(p => p.name).join(', ')}`, 'announce')
      if (eco && reward) for (const p of winners) { eco.add(p.name, reward); p.message(`&a+${reward} ${eco.currency}!`) }
    }
    if (this.hooks.onEnd) this.hooks.onEnd(winners)
    this.restoreArena()
    for (const p of this.players) this._resetPlayer(p)
    this.players.clear()
    this.clearTimers()
    this.state = 'waiting'
  }

  restoreArena () {
    if (!this.snapshot) return
    const level = this.level
    const { blocks, upper } = this.snapshot
    const changes = []
    for (let i = 0; i < blocks.length; i++) {
      const original = upper ? blocks[i] | (upper[i] << 8) : blocks[i]
      if (level.getAt(i) !== original) {
        const { x, y, z } = level.unpack(i)
        changes.push([x, y, z, original])
      }
    }
    level.setBlocks(changes)
    this.snapshot = null
  }

  _resetPlayer (p) {
    for (const line of ['status1', 'status2', 'status3', 'bottom1']) p.message('', line)
    if (p.conn.closed) return
    p.setHacks({})
    if (p.record && p.currentModel && p.currentModel !== (p.record.model || 'humanoid')) p.setModel(p.record.model || 'humanoid', false)
    delete p.data.team
  }

  later (fn, ms) {
    const t = this.ctx.setTimeout(fn, ms)
    this.timers.push(t)
    return t
  }

  repeat (fn, ms) {
    const t = this.ctx.setInterval(fn, ms)
    this.timers.push(t)
    return t
  }

  clearTimers () {
    for (const t of this.timers) this.ctx.clearTimer(t)
    this.timers = []
  }
}

// Distance in blocks between two protocol positions (1/32 units)
function distance (a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / 32
}

function randomItem (list) { return list[Math.floor(Math.random() * list.length)] }

module.exports = { Round, distance, randomItem }
