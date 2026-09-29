'use strict'

const fs = require('fs')
const { JsonStore } = require('./json-store')

function newRecord (name) {
  return {
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
}

// Persistent information about every player that joined the server (data/players.json).
class PlayerDB {
  constructor (file) {
    this.store = new JsonStore(file, {})
    // keyed by player name, so no prototype: a player called "__proto__" or "constructor" is just a key
    this.store.data = Object.assign(Object.create(null), this.store.data)
  }

  key (name) { return String(name).toLowerCase() }

  get (name) {
    return this.store.data[this.key(name)] || null
  }

  getOrCreate (name) {
    const k = this.key(name)
    if (!this.store.data[k]) {
      this.store.data[k] = newRecord(name)
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

// Same interface, stored in an SQLite database (data/players.db) using Node's built-in node:sqlite.
// Better for servers with many thousands of players: records are loaded on demand and only
// the ones that changed are written back.
class SqlitePlayerDB {
  constructor (file, { importFrom } = {}) {
    const { DatabaseSync } = require('node:sqlite')
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('CREATE TABLE IF NOT EXISTS players (key TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL)')
    this.cache = new Map() // key -> { record, json }
    this.timer = null
    this.stmt = {
      get: this.db.prepare('SELECT data FROM players WHERE key = ?'),
      put: this.db.prepare('INSERT INTO players (key, name, data) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name, data = excluded.data'),
      prefix: this.db.prepare("SELECT key, data FROM players WHERE key LIKE ? ESCAPE '\\' LIMIT 3"),
      all: this.db.prepare('SELECT key, data FROM players'),
      count: this.db.prepare('SELECT COUNT(*) AS n FROM players')
    }
    if (importFrom && fs.existsSync(importFrom) && this.stmt.count.get().n === 0) this._import(importFrom)
  }

  _import (file) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    this.db.exec('BEGIN')
    for (const [key, record] of Object.entries(data)) this.stmt.put.run(key, record.name, JSON.stringify(record))
    this.db.exec('COMMIT')
  }

  key (name) { return String(name).toLowerCase() }

  _cached (key, json) {
    let entry = this.cache.get(key)
    if (!entry) {
      entry = { record: JSON.parse(json), json }
      this.cache.set(key, entry)
    }
    return entry.record
  }

  get (name) {
    const k = this.key(name)
    if (this.cache.has(k)) return this.cache.get(k).record
    const row = this.stmt.get.get(k)
    return row ? this._cached(k, row.data) : null
  }

  getOrCreate (name) {
    const existing = this.get(name)
    if (existing) return existing
    const record = newRecord(name)
    this.cache.set(this.key(name), { record, json: null })
    this.save()
    return record
  }

  update (name, fields) {
    Object.assign(this.getOrCreate(name), fields)
    this.save()
  }

  // Read-only listing (records that are not cached are fresh copies)
  all () {
    return this.stmt.all.all().map(row => this.cache.has(row.key) ? this.cache.get(row.key).record : JSON.parse(row.data))
  }

  find (partial) {
    const exact = this.get(partial)
    if (exact) return exact
    const p = this.key(partial)
    const escaped = p.replace(/[\\%_]/g, '\\$&')
    // records created since the last flush are only in the cache
    const matches = new Map(this.stmt.prefix.all(escaped + '%').map(row => [row.key, row.data]))
    for (const key of this.cache.keys()) if (key.startsWith(p)) matches.set(key, null)
    if (matches.size !== 1) return null
    const [key, data] = [...matches][0]
    return data === null ? this.cache.get(key).record : this._cached(key, data)
  }

  save () {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 1000)
    if (this.timer.unref) this.timer.unref()
  }

  // Writes every cached record that changed since it was last written
  flush () {
    clearTimeout(this.timer)
    this.timer = null
    const changed = []
    for (const [key, entry] of this.cache) {
      const json = JSON.stringify(entry.record)
      if (json !== entry.json) changed.push([key, entry, json])
    }
    if (!changed.length) return
    this.db.exec('BEGIN')
    for (const [key, entry, json] of changed) {
      this.stmt.put.run(key, entry.record.name, json)
      entry.json = json
    }
    this.db.exec('COMMIT')
  }

  close () {
    this.flush()
    this.db.close()
  }
}

// Picks the storage backend from config.database ('json' or 'sqlite')
function createPlayerDB (dataDir, type, log) {
  const path = require('path')
  const jsonFile = path.join(dataDir, 'players.json')
  if (type === 'sqlite') {
    try {
      return new SqlitePlayerDB(path.join(dataDir, 'players.db'), { importFrom: jsonFile })
    } catch (err) {
      if (log) log.warn(`SQLite is not available in this Node version (${err.message}); using players.json instead.`)
    }
  }
  return new PlayerDB(jsonFile)
}

module.exports = { PlayerDB, SqlitePlayerDB, createPlayerDB, newRecord }
