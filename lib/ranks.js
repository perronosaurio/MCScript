'use strict'

const fs = require('fs')

// Rank system inspired by MCGalaxy: every rank has a numeric permission level.
// Commands, blocks and levels require a minimum rank.

const DEFAULT_RANKS = [
  { name: 'Banned', permission: -20, color: '&8', prefix: '', drawLimit: 0, maxUndo: 0 },
  { name: 'Guest', permission: 0, color: '&7', prefix: '', drawLimit: 0, maxUndo: 0 },
  { name: 'Builder', permission: 30, color: '&2', prefix: '', drawLimit: 50000, maxUndo: 20000 },
  { name: 'AdvBuilder', permission: 50, color: '&3', prefix: '', drawLimit: 250000, maxUndo: 100000 },
  { name: 'Operator', permission: 80, color: '&c', prefix: '', drawLimit: 2000000, maxUndo: 500000 },
  { name: 'Admin', permission: 100, color: '&e', prefix: '', drawLimit: 5000000, maxUndo: 1000000 },
  { name: 'Owner', permission: 120, color: '&4', prefix: '', drawLimit: 16777216, maxUndo: 5000000 }
]

class Ranks {
  constructor (file, defaultRank) {
    this.file = file
    if (file && fs.existsSync(file)) {
      this.list = JSON.parse(fs.readFileSync(file, 'utf8'))
    } else {
      this.list = DEFAULT_RANKS.map(r => ({ ...r }))
      if (file) fs.writeFileSync(file, JSON.stringify(this.list, null, 2))
    }
    this.list.sort((a, b) => a.permission - b.permission)
    this.defaultName = defaultRank || 'Guest'
  }

  get all () { return this.list }

  get default () { return this.get(this.defaultName) || this.list.find(r => r.permission >= 0) || this.list[0] }

  get lowest () { return this.list[0] }

  get highest () { return this.list[this.list.length - 1] }

  // by name (case-insensitive) or permission number
  get (nameOrPerm) {
    if (nameOrPerm === null || nameOrPerm === undefined) return null
    if (typeof nameOrPerm === 'object') return nameOrPerm
    const s = String(nameOrPerm).toLowerCase()
    if (/^-?\d+$/.test(s)) {
      const n = Number(s)
      // exact match, otherwise the highest rank below
      return this.list.find(r => r.permission === n) || [...this.list].reverse().find(r => r.permission <= n) || this.lowest
    }
    return this.list.find(r => r.name.toLowerCase() === s) || null
  }

  // Minimum permission number for a rank reference (name, number or rank object)
  permissionOf (ref) {
    if (ref === null || ref === undefined) return this.default.permission
    if (typeof ref === 'number') return ref
    const r = this.get(ref)
    return r ? r.permission : this.default.permission
  }

  next (rank) {
    const i = this.list.indexOf(this.get(rank))
    return i >= 0 && i < this.list.length - 1 ? this.list[i + 1] : null
  }
}

module.exports = { Ranks, DEFAULT_RANKS }
