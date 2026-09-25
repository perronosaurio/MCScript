'use strict'

const fs = require('fs')
const path = require('path')
const { Level, defaultEnv } = require('./level')
const { generators } = require('./generators')

const NAME_RE = /^[A-Za-z0-9_.+-]{1,32}$/

class LevelManager {
  constructor (server, opts) {
    this.server = server
    this.dir = opts.dir
    this.backupDir = path.join(this.dir, 'backups')
    this.deletedDir = path.join(this.dir, 'deleted')
    this.backupsToKeep = opts.backupsToKeep ?? 10
    this.loaded = new Map()
    this.main = null
    fs.mkdirSync(this.dir, { recursive: true })
  }

  static isValidName (name) { return NAME_RE.test(name || '') }

  defaultEnv () { return defaultEnv() }

  file (name) { return path.join(this.dir, `${name}.cw`) }

  // Case-insensitive lookup of a level file name on disk
  resolveName (name) {
    if (!name) return null
    const lower = name.toLowerCase()
    for (const l of this.loaded.values()) if (l.name.toLowerCase() === lower) return l.name
    for (const f of this.listFiles()) if (f.toLowerCase() === lower) return f
    return null
  }

  listFiles () {
    return fs.readdirSync(this.dir)
      .filter(f => f.endsWith('.cw'))
      .map(f => f.slice(0, -3))
      .sort((a, b) => a.localeCompare(b))
  }

  get (name) {
    return name ? this.loaded.get(name.toLowerCase()) || null : null
  }

  exists (name) { return this.resolveName(name) !== null }

  _register (level) {
    level.server = this.server
    this.loaded.set(level.name.toLowerCase(), level)
    this.server.events.fire('levelLoad', { level })
    this.server.log.info(`Loaded level &a${level.name}&f (${level.width}x${level.height}x${level.length})`)
    return level
  }

  load (name) {
    const existing = this.get(name)
    if (existing) return existing
    const real = this.resolveName(name)
    if (!real) throw new Error(`Level "${name}" does not exist`)
    const level = Level.fromCW(fs.readFileSync(this.file(real)), real)
    return this._register(level)
  }

  create (name, { width = 128, height = 64, length = 128, type = 'flat', seed, creator } = {}) {
    if (!LevelManager.isValidName(name)) throw new Error('Invalid level name (use letters, numbers, _ . + -)')
    if (this.exists(name)) throw new Error(`Level "${name}" already exists`)
    const gen = generators[type]
    if (!gen) throw new Error(`Unknown generator "${type}". Available: ${Object.keys(generators).join(', ')}`)
    const level = new Level({ name, width, height, length })
    level.createdBy = creator || null
    level.generator = type
    gen.generate(level, { seed: seed ?? Math.floor(Math.random() * 2 ** 31) })
    this.save(level)
    return this._register(level)
  }

  // Import a foreign map file (.lvl from MCGalaxy, legacy MCScript .dat) found in the levels folder
  import (fileName, newName) {
    const src = path.join(this.dir, path.basename(fileName))
    if (!fs.existsSync(src)) throw new Error(`File ${path.basename(fileName)} not found in ${this.dir}`)
    const name = newName || path.basename(fileName).replace(/\.[^.]+$/, '')
    if (!LevelManager.isValidName(name)) throw new Error('Invalid level name')
    if (this.exists(name)) throw new Error(`Level "${name}" already exists`)
    let level
    if (src.endsWith('.lvl')) level = Level.fromLvl(fs.readFileSync(src), name)
    else if (src.endsWith('.dat')) level = Level.fromLegacyDat(fs.readFileSync(src), name)
    else if (src.endsWith('.cw')) level = Level.fromCW(fs.readFileSync(src), name)
    else throw new Error('Supported formats: .cw, .lvl (MCGalaxy), .dat (old MCScript)')
    this.save(level)
    this._register(level)
    return level
  }

  save (level) {
    const data = level.toCW()
    const file = this.file(level.name)
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, file)
    level.dirty = false
    this.server.events.fire('levelSave', { level })
  }

  saveAll (onlyDirty = true) {
    let n = 0
    for (const level of this.loaded.values()) {
      if (onlyDirty && !level.dirty) continue
      try { this.save(level); n++ } catch (err) { this.server.log.error(`Failed to save ${level.name}:`, err) }
    }
    return n
  }

  unload (name, { save = true } = {}) {
    const level = this.get(name)
    if (!level) return false
    if (level === this.main) throw new Error('The main level cannot be unloaded')
    const ev = this.server.events.fire('levelUnload', { level })
    if (ev.cancelled) return false
    for (const p of level.players) p.changeLevel(this.main, { silent: true })
    if (save && level.dirty) this.save(level)
    this.loaded.delete(level.name.toLowerCase())
    this.server.log.info(`Unloaded level ${level.name}`)
    return true
  }

  // Deleted maps are moved to levels/deleted so they can be recovered
  delete (name) {
    const real = this.resolveName(name)
    if (!real) throw new Error(`Level "${name}" does not exist`)
    if (this.main && real.toLowerCase() === this.main.name.toLowerCase()) throw new Error('The main level cannot be deleted')
    if (this.get(real)) this.unload(real, { save: false })
    fs.mkdirSync(this.deletedDir, { recursive: true })
    fs.renameSync(this.file(real), path.join(this.deletedDir, `${real}-${Date.now()}.cw`))
  }

  backup (level) {
    const dir = path.join(this.backupDir, level.name)
    fs.mkdirSync(dir, { recursive: true })
    const existing = this.listBackups(level.name)
    const next = existing.length ? existing[existing.length - 1] + 1 : 1
    fs.writeFileSync(path.join(dir, `${next}.cw`), level.toCW())
    const all = [...existing, next]
    while (all.length > this.backupsToKeep) {
      const old = all.shift()
      fs.rmSync(path.join(dir, `${old}.cw`), { force: true })
    }
    return next
  }

  listBackups (name) {
    const dir = path.join(this.backupDir, name)
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .filter(f => /^\d+\.cw$/.test(f))
      .map(f => Number(f.slice(0, -3)))
      .sort((a, b) => a - b)
  }

  restore (level, backup) {
    const file = path.join(this.backupDir, level.name, `${backup}.cw`)
    if (!fs.existsSync(file)) throw new Error(`Backup ${backup} not found`)
    const restored = Level.fromCW(fs.readFileSync(file), level.name)
    if (restored.width !== level.width || restored.height !== level.height || restored.length !== level.length) {
      throw new Error('Backup has different dimensions')
    }
    level.blocks.set(restored.blocks)
    level.env = restored.env
    level.blockDefs = restored.blockDefs
    level.meta = restored.meta
    level.dirty = true
    for (const p of level.players) p.changeLevel(level, { silent: true, force: true })
  }

  // Load or create the main level, migrating the pre-2.0 levels/level.dat if present
  initMain (name) {
    if (this.exists(name)) {
      this.main = this.load(name)
    } else if (fs.existsSync(path.join(this.dir, 'level.dat'))) {
      this.server.log.info('Migrating legacy levels/level.dat to the new .cw format...')
      this.main = this.import('level.dat', name)
    } else {
      this.main = this.create(name, { width: 256, height: 64, length: 256, type: 'terrain' })
    }
    return this.main
  }
}

module.exports = { LevelManager }
