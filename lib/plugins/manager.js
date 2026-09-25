'use strict'

const fs = require('fs')
const path = require('path')
const { CommandError } = require('../commands/manager')
const text = require('../util/text')
const Blocks = require('../blocks')

const API_VERSION = 1

// Loads plugins from the plugins/ folder. A plugin is either plugins/<name>.js or plugins/<name>/index.js
// and exports: { name, version, description, author, depends, defaultConfig, load(ctx), unload(ctx), api }
class PluginManager {
  constructor (server, opts) {
    this.server = server
    this.dir = opts.dir
    this.configDir = opts.configDir
    this.dataDir = opts.dataDir
    this.disabled = new Set((opts.disabled || []).map(n => n.toLowerCase()))
    this.plugins = new Map() // name(lower) -> { module, ctx, file }
  }

  // name -> file path of every plugin found on disk
  discover () {
    const found = new Map()
    if (!fs.existsSync(this.dir)) return found
    for (const entry of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      if (entry.isDirectory()) {
        const index = path.join(this.dir, entry.name, 'index.js')
        if (fs.existsSync(index)) found.set(entry.name.toLowerCase(), index)
      } else if (entry.name.endsWith('.js')) {
        found.set(entry.name.slice(0, -3).toLowerCase(), path.join(this.dir, entry.name))
      }
    }
    return found
  }

  get (name) {
    const p = this.plugins.get(String(name).toLowerCase())
    return p || null
  }

  list () { return [...this.plugins.values()] }

  loadAll () {
    const found = this.discover()
    const modules = new Map()
    for (const [name, file] of found) {
      if (this.disabled.has(name)) continue
      try {
        const mod = this._require(file)
        if (!this._isValid(mod)) {
          this.server.log.warn(`Ignoring ${path.relative(process.cwd(), file)}: old MCScript 1.x plugin format (see docs/PLUGINS.md)`)
          continue
        }
        modules.set((mod.name || name).toLowerCase(), { mod, file })
      } catch (err) {
        this.server.log.error(`Failed to read plugin ${name}:`, err)
      }
    }

    // load respecting dependencies
    const loading = new Set()
    const visit = (name) => {
      if (this.plugins.has(name) || loading.has(name)) return
      const entry = modules.get(name)
      if (!entry) return
      loading.add(name)
      for (const dep of entry.mod.depends || []) {
        if (!modules.has(dep.toLowerCase()) && !this.plugins.has(dep.toLowerCase())) {
          this.server.log.error(`Plugin ${entry.mod.name} needs "${dep}" which is not installed`)
          return
        }
        visit(dep.toLowerCase())
      }
      try {
        this._activate(entry.mod, entry.file)
      } catch (err) {
        // already logged; a broken plugin must not stop the server from starting
      }
    }
    for (const name of [...modules.keys()].sort()) visit(name)
  }

  _require (file) {
    // clear cached copies of the plugin's files so reloads pick up changes
    const base = path.dirname(file) === path.resolve(this.dir) ? file : path.dirname(file)
    for (const key of Object.keys(require.cache)) {
      if (key === file || key.startsWith(base + path.sep)) delete require.cache[key]
    }
    return require(file)
  }

  _isValid (mod) {
    return mod && typeof mod === 'object' && typeof mod.load === 'function'
  }

  load (name) {
    const lower = String(name).toLowerCase()
    if (this.plugins.has(lower)) throw new Error(`Plugin ${name} is already loaded`)
    const file = this.discover().get(lower)
    if (!file) throw new Error(`Plugin ${name} not found in ${this.dir}`)
    const mod = this._require(file)
    if (!this._isValid(mod)) throw new Error(`${name} is not a valid plugin (it must export a load(ctx) function)`)
    for (const dep of mod.depends || []) {
      if (!this.plugins.has(dep.toLowerCase())) this.load(dep)
    }
    return this._activate(mod, file)
  }

  _activate (mod, file) {
    const name = mod.name || path.basename(file, '.js')
    if (mod.apiVersion && mod.apiVersion > API_VERSION) {
      this.server.log.warn(`Plugin ${name} targets plugin API v${mod.apiVersion}, this server supports v${API_VERSION}`)
    }
    const ctx = this._createContext(name, mod, file)
    const entry = { name, module: mod, ctx, file, loadedAt: Date.now() }
    this.plugins.set(name.toLowerCase(), entry)
    try {
      mod.load(ctx)
      this.server.log.info(`Plugin &a${name}&f ${mod.version ? 'v' + mod.version + ' ' : ''}loaded`)
      this.server.events.fire('pluginLoad', { plugin: entry })
      return entry
    } catch (err) {
      this.server.log.error(`Plugin ${name} failed to load:`, err)
      this._cleanup(entry)
      this.plugins.delete(name.toLowerCase())
      throw err
    }
  }

  unload (name) {
    const entry = this.get(name)
    if (!entry) throw new Error(`Plugin ${name} is not loaded`)
    const dependents = this.list().filter(p => (p.module.depends || []).some(d => d.toLowerCase() === entry.name.toLowerCase()))
    for (const dep of dependents) this.unload(dep.name)
    try {
      if (typeof entry.module.unload === 'function') entry.module.unload(entry.ctx)
    } catch (err) {
      this.server.log.error(`Plugin ${entry.name} threw while unloading:`, err)
    }
    this._cleanup(entry)
    this.plugins.delete(entry.name.toLowerCase())
    this.server.events.fire('pluginUnload', { plugin: entry })
    this.server.log.info(`Plugin ${entry.name} unloaded`)
  }

  reload (name) {
    const entry = this.get(name)
    const realName = entry ? entry.name : name
    if (entry) this.unload(realName)
    return this.load(realName)
  }

  unloadAll () {
    for (const entry of this.list().reverse()) {
      try { this.unload(entry.name) } catch (err) {}
    }
  }

  _cleanup (entry) {
    const owner = entry.name
    this.server.events.removeOwner(owner)
    this.server.commands.removeOwner(owner)
    for (const t of entry.ctx._timers) { clearTimeout(t); clearInterval(t) }
    for (const fn of entry.ctx._disposers.reverse()) {
      try { fn() } catch (err) { this.server.log.error(`Cleanup error in ${owner}:`, err) }
    }
    entry.ctx._timers.clear()
    entry.ctx._disposers.length = 0
  }

  _createContext (name, mod, file) {
    const server = this.server
    const manager = this
    const configFile = path.join(this.configDir, `${name}.json`)
    const dataDir = path.join(this.dataDir, name)

    let config = JSON.parse(JSON.stringify(mod.defaultConfig || {}))
    if (fs.existsSync(configFile)) {
      try {
        config = { ...config, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) }
      } catch (err) {
        server.log.error(`Invalid config file ${configFile}:`, err.message)
      }
    } else if (mod.defaultConfig) {
      fs.mkdirSync(this.configDir, { recursive: true })
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2))
    }

    const ctx = {
      name,
      server,
      log: server.log.child(name),
      config,
      dir: path.dirname(file),
      dataDir,
      text,
      Blocks,
      CommandError,
      _timers: new Set(),
      _disposers: [],

      saveConfig () {
        fs.mkdirSync(manager.configDir, { recursive: true })
        fs.writeFileSync(configFile, JSON.stringify(ctx.config, null, 2))
      },
      loadData (fileName, defaults = {}) {
        const f = path.join(dataDir, fileName)
        if (!fs.existsSync(f)) return JSON.parse(JSON.stringify(defaults))
        return JSON.parse(fs.readFileSync(f, 'utf8'))
      },
      saveData (fileName, data) {
        fs.mkdirSync(dataDir, { recursive: true })
        const f = path.join(dataDir, fileName)
        fs.writeFileSync(f + '.tmp', JSON.stringify(data, null, 2))
        fs.renameSync(f + '.tmp', f)
      },
      on (event, handler, opts = {}) {
        return server.events.on(event, handler, { ...opts, owner: name })
      },
      command (def) {
        return server.commands.register({ ...def, owner: name })
      },
      setInterval (fn, ms) {
        const t = setInterval(() => { try { fn() } catch (err) { ctx.log.error(err) } }, ms)
        ctx._timers.add(t)
        return t
      },
      setTimeout (fn, ms) {
        const t = setTimeout(() => { ctx._timers.delete(t); try { fn() } catch (err) { ctx.log.error(err) } }, ms)
        ctx._timers.add(t)
        return t
      },
      clearTimer (t) { clearTimeout(t); clearInterval(t); ctx._timers.delete(t) },
      onUnload (fn) { ctx._disposers.push(fn) },
      getPlugin (other) {
        const p = manager.get(other)
        return p ? p.module.api || p.module : null
      }
    }
    return ctx
  }
}

module.exports = { PluginManager, API_VERSION }
