'use strict'

const { JsonStore } = require('./json-store')

// Persistent information about every player that joined the server.
class PlayerDB {
  constructor (file) {
    this.store = new JsonStore(file, {})
  }

  key (name) { return String(name).toLowerCase() }

  get (name) {
    return this.store.data[this.key(name)] || null
  }

  getOrCreate (name) {
    const k = this.key(name)
    if (!this.store.data[k]) {
      this.store.data[k] = {
        name,
        rank: null,
        firstLogin: Date.now(),
        lastLogin: Date.now(),
        logins: 0,
        timeSpent: 0,
        blocksPlaced: 0,
        blocksDeleted: 0,
        messages: 0,
        kicks: 0,
        ips: [],
        lastIp: null,
        nick: null,
        color: null,
        title: null,
        titleColor: null,
        model: null,
        skin: null,
        muteUntil: null,
        muteReason: null,
        ban: null
      }
      this.save()
    }
    return this.store.data[k]
  }

  update (name, fields) {
    Object.assign(this.getOrCreate(name), fields)
    this.save()
  }

  all () { return Object.values(this.store.data) }

  // Find by exact name, or a unique prefix
  find (partial) {
    const exact = this.get(partial)
    if (exact) return exact
    const p = this.key(partial)
    const matches = this.all().filter(r => r.name.toLowerCase().startsWith(p))
    return matches.length === 1 ? matches[0] : null
  }

  save () { this.store.save() }
  flush () { this.store.flush() }
}

module.exports = { PlayerDB }
