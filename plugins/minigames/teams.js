'use strict'

const TEAMS = {
  red: { name: 'Red', color: '&c', flagBlock: 21 },
  blue: { name: 'Blue', color: '&9', flagBlock: 29 }
}

// Splits players into red/blue teams, balancing sizes
function assignTeams (players) {
  const shuffled = [...players].sort(() => Math.random() - 0.5)
  shuffled.forEach((p, i) => { p.data.team = i % 2 === 0 ? 'red' : 'blue' })
}

function smallerTeam (players) {
  let red = 0; let blue = 0
  for (const p of players) { if (p.data.team === 'red') red++; else if (p.data.team === 'blue') blue++ }
  return red <= blue ? 'red' : 'blue'
}

function teamOf (p) { return TEAMS[p.data.team] || null }

function spawnAt (player, spawn, level) {
  const s = spawn || level.spawn
  player.teleport(s.x, s.y, s.z, s.yaw || 0, s.pitch || 0)
}

// marks the player's position as a team spawn
function positionOf (player) {
  const p = player.feetPos
  return { x: p.x, y: p.y, z: p.z, yaw: player.yaw, pitch: player.pitch }
}

module.exports = { TEAMS, assignTeams, smallerTeam, teamOf, spawnAt, positionOf }
