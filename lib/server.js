'use strict'

const net = require('net')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const readline = require('readline')

const { Connection } = require('./network/connection')
const { Player, toUnits, EYE } = require('./player')
const { EventBus } = require('./events')
const { Logger } = require('./util/logger')
const { Ranks } = require('./ranks')
const { PlayerDB } = require('./storage/player-db')
const { JsonStore } = require('./storage/json-store')
const { CommandManager, CommandError } = require('./commands/manager')
const { PluginManager } = require('./plugins/manager')
const { LevelManager } = require('./level/manager')
const { BlockPermissions } = require('./block-permissions')
const { Heartbeat } = require('./heartbeat')
const { generators } = require('./level/generators')
const { saveConfig } = require('./config')
const Blocks = require('./blocks')
const text = require('./util/text')
const registerCoreCommands = require('./commands/core')

const MAX_ENTITY_ID = 126

class MCScriptServer {
  constructor (config) {
    this.config = config
    this.root = config.root || process.cwd()
    this.version = require('../package.json').version
    this.log = new Logger({ dir: config.logToFile ? path.join(this.root, 'logs') : null, debug: config.debug, silent: config.silent })
    this.events = new EventBus(this.log)
    this.salt = randomSalt(16)
    this.players = []
    this.entities = new Map() // non-player entities (bots/NPCs): id -> entity
    this._usedIds = new Set()
    this.startedAt = Date.now()
    this.running = false

    for (const [code] of Object.entries(config.customColors || {})) text.extraColorCodes.add(code)

    const configDir = path.join(this.root, 'config')
    const dataDir = path.join(this.root, 'data')
    fs.mkdirSync(configDir, { recursive: true })
    fs.mkdirSync(dataDir, { recursive: true })

    this.ranks = new Ranks(path.join(configDir, 'ranks.json'), config.defaultRank)
    this.playerDB = new PlayerDB(path.join(dataDir, 'players.json'))
    this.blockPerms = new BlockPermissions(this, path.join(configDir, 'blockperms.json'))
    this.globalBlocks = new JsonStore(path.join(dataDir, 'blockdefs.json'), {})
    this.commands = new CommandManager(this, path.join(configDir, 'commands.json'))
    this.levels = new LevelManager(this, { dir: path.join(this.root, 'levels'), backupsToKeep: config.backupsToKeep })
    this.plugins = new PluginManager(this, {
      dir: path.resolve(this.root, config.pluginsDir || 'plugins'),
      configDir: path.join(configDir, 'plugins'),
      dataDir: path.join(dataDir, 'plugins'),
      disabled: config.disabledPlugins
    })
    this.heartbeat = new Heartbeat(this)
    this.tabList = new TabList(this)
    this.console = new ConsolePlayer(this)
    this.CommandError = CommandError
    this.Blocks = Blocks
    this.text = text
    this.generators = generators
  }

  // Persists changes made to server.config (e.g. by commands) to config/server.json
  saveConfig () { saveConfig(this.config) }

  // Global custom block definitions (id -> definition)
  get blockDefs () { return this.globalBlocks.data }

  // ------------------------------------------------------------------ lifecycle

  async start () {
    const cfg = this.config
    this.log.info(`Starting &bMCScript ${this.version}&f (Node ${process.version})`)
    this.levels.initMain(cfg.mainLevel)
    registerCoreCommands(this)
    this.plugins.loadAll()

    this.tcp = net.createServer(socket => this._onConnection(socket))
    this.tcp.maxConnections = cfg.maxPlayers + 10
    await new Promise((resolve, reject) => {
      this.tcp.once('error', reject)
      this.tcp.listen(cfg.port, cfg.host, () => { this.tcp.off('error', reject); resolve() })
    })
    this.port = this.tcp.address().port
    this.running = true
    this.log.info(`Listening on &a${cfg.host}:${this.port}&f${cfg.allowWebClient ? ' (desktop + web client)' : ''}`)

    if (cfg.autosaveMinutes > 0) {
      this._autosave = setInterval(() => {
        const n = this.levels.saveAll(true)
        if (n) this.log.info(`Autosaved ${n} level${n > 1 ? 's' : ''}`)
        this.playerDB.flush()
      }, cfg.autosaveMinutes * 60000)
    }
    if (cfg.backupMinutes > 0) {
      this._backups = setInterval(() => {
        for (const level of this.levels.loaded.values()) {
          if (!level.changedSinceBackup) continue
          try { this.levels.backup(level); level.changedSinceBackup = false } catch (err) { this.log.error('Backup failed:', err) }
        }
      }, cfg.backupMinutes * 60000)
      this.events.on('levelSave', ({ level }) => { level.changedSinceBackup = true })
    }
    if (cfg.public) this.heartbeat.start()
    this.events.fire('serverStart', { server: this })
    return this
  }

  async stop (reason = 'Server is shutting down') {
    if (!this.running) return
    this.running = false
    this.log.info('Stopping server...')
    this.events.fire('serverStop', { server: this, reason })
    for (const p of [...this.players]) p.kick(reason)
    clearInterval(this._autosave)
    clearInterval(this._backups)
    this.heartbeat.stop()
    this.plugins.unloadAll()
    this.levels.saveAll(true)
    this.playerDB.flush()
    this.globalBlocks.flush()
    if (this._rl) this._rl.close()
    await new Promise(resolve => this.tcp.close(() => resolve()))
    this.log.info('Server stopped.')
    this.log.close()
  }

  startConsole (input = process.stdin) {
    this._rl = readline.createInterface({ input, terminal: false })
    this._rl.on('line', line => {
      line = line.trim()
      if (!line) return
      if (line.startsWith('/')) this.commands.execute(this.console, line)
      else if (['stop', 'exit', 'quit'].includes(line)) this.commands.execute(this.console, '/stop')
      else if (this.commands.find(line.split(' ')[0])) this.commands.execute(this.console, line)
      else this.broadcast(`&d[Console]&f: ${text.sanitize(line)}`)
    })
  }

  // ------------------------------------------------------------------ connections

  _onConnection (socket) {
    if (!this.running) return socket.destroy()
    const conn = new Connection(socket)
    conn.on('socketError', err => this.log.debug(`Socket error (${conn.socketIp}): ${err.message}`))
    // eslint-disable-next-line no-new
    new Player(this, conn)
  }

  _allocateId () {
    for (let id = 0; id <= MAX_ENTITY_ID; id++) {
      if (!this._usedIds.has(id)) { this._usedIds.add(id); return id }
    }
    return null
  }

  _freeId (id) { this._usedIds.delete(id) }

  _addPlayer (player) {
    player.id = this._allocateId()
    if (player.id === null) return player.kick('Too many entities on the server')
    this.players.push(player)
  }

  _onPlayerJoin (player) {
    this.tabList.addAllFor(player)
    this.broadcast(`&a+ ${player.coloredName} &ejoined the game`, p => p !== player)
    const welcome = String(this.config.welcomeMessage || '').replace(/\{player\}/g, player.name)
    if (welcome) player.message(welcome)
    this.events.fire('playerJoin', { player })
  }

  _onPlayerDisconnect (player) {
    const i = this.players.indexOf(player)
    if (i === -1) return
    this.players.splice(i, 1)
    clearInterval(player._pingTimer)
    if (player.selection) player.cancelSelection()
    for (const other of this.players) {
      if (other.level === player.level && other.spawned) other.hideEntity(player.id)
    }
    this.tabList.remove(player)
    this._freeId(player.id)
    if (player.record) {
      player.record.timeSpent += Date.now() - player.joinedAt
      this.playerDB.save()
    }
    this.events.fire('playerLeave', { player, reason: player.kickReason || null })
    if (player.loggedIn) {
      const why = player.kickReason && !/^(Someone else logged in|Server is shutting)/.test(player.kickReason) ? ` &7(${player.kickReason})` : ''
      this.broadcast(`&c- ${player.coloredName} &eleft the game${why}`)
      this.log.info(`${player.name} disconnected${player.kickReason ? ' (' + player.kickReason + ')' : ''}`)
    }
  }

  // ------------------------------------------------------------------ players

  get online () { return this.players.filter(p => p.loggedIn) }

  findPlayerExact (name) {
    const lower = String(name).toLowerCase()
    return this.players.find(p => p.loggedIn && p.name.toLowerCase() === lower) || null
  }

  // Exact name, or unique partial match. Returns { player, matches }
  matchPlayers (partial) {
    const exact = this.findPlayerExact(partial)
    if (exact) return [exact]
    const lower = String(partial).toLowerCase()
    return this.online.filter(p => p.name.toLowerCase().includes(lower))
  }

  // Finds a player for a command, telling `requester` if none or several match
  findPlayer (partial, requester) {
    if (!partial) return null
    const matches = this.matchPlayers(partial)
    if (matches.length === 1) return matches[0]
    if (requester) {
      if (!matches.length) requester.message(`&cNo player online matches "${partial}".`)
      else requester.message(`&cMultiple players match "${partial}": &f${matches.map(p => p.name).join(', ')}`)
    }
    return null
  }

  broadcast (msg, filter, type = 'chat') {
    for (const p of this.players) {
      if (!p.loggedIn) continue
      if (filter && !filter(p)) continue
      p.message(msg, type)
    }
    if (!filter) this.log.info(msg)
  }

  setRank (name, rank, by) {
    const record = this.playerDB.getOrCreate(name)
    const from = this.ranks.get(record.rank) || this.ranks.default
    record.rank = rank.name
    this.playerDB.save()
    this.events.fire('playerRankChange', { name: record.name, from, to: rank, by })
    const player = this.findPlayerExact(name)
    if (player) {
      if (player.supports('InstantMOTD')) player._sendIdentification(player.level)
      else player.conn.write('updateUserType', { userType: this.blockPerms.canDelete(player, 7) ? 0x64 : 0 })
      player.sendBlockPermissions()
      player.respawnForOthers()
    }
  }

  // ------------------------------------------------------------------ blocks

  // changes: [[index, block], ...] already applied to level.blocks
  broadcastBlockChanges (level, changes) {
    for (const p of this.players) {
      if (p.level !== level || !p.spawned) continue
      if (changes.length === 1 || !p.supports('BulkBlockUpdate')) {
        if (changes.length > 4096) { p.reloadLevel(); continue }
        for (const [i, block] of changes) {
          const { x, y, z } = level.unpack(i)
          p.conn.write('setBlock', { x, y, z, block: p.convertBlock(block) })
        }
        continue
      }
      for (let s = 0; s < changes.length; s += 256) {
        const part = changes.slice(s, s + 256)
        const indices = Buffer.alloc(1024)
        const blocks = Buffer.alloc(256)
        part.forEach(([i, block], n) => { indices.writeInt32BE(i, n * 4); blocks[n] = p.convertBlock(block) })
        p.conn.write('bulkBlockUpdate', { count: part.length - 1, indices, blocks })
      }
    }
  }

  // Global custom blocks (/gb). Level blocks live in level.blockDefs (/lb).
  setGlobalBlock (def) {
    def = Blocks.normalize(def)
    this.globalBlocks.data[def.id] = def
    this.globalBlocks.save()
    this._refreshBlockDefs(null)
    return def
  }

  removeGlobalBlock (id) {
    delete this.globalBlocks.data[id]
    this.globalBlocks.save()
    this._refreshBlockDefs(null)
  }

  setLevelBlock (level, def) {
    def = Blocks.normalize(def)
    level.blockDefs[def.id] = def
    level.dirty = true
    this._refreshBlockDefs(level)
    return def
  }

  removeLevelBlock (level, id) {
    delete level.blockDefs[id]
    level.dirty = true
    this._refreshBlockDefs(level)
  }

  _refreshBlockDefs (level) {
    for (const p of this.players) {
      if (!p.spawned || (level && p.level !== level)) continue
      p.sendBlockDefinitions()
      p.sendBlockPermissions()
    }
  }

  // ------------------------------------------------------------------ entities (bots / NPCs)

  entitiesIn (level) {
    return [...this.entities.values()].filter(e => e.level === level)
  }

  // Creates a non-player entity visible to players in `level`. Position in blocks (feet).
  createEntity ({ name, skin, model = 'humanoid', level, x, y, z, yaw = 0, pitch = 0, scale = null, data = {} }) {
    const id = this._allocateId()
    if (id === null) throw new Error('No free entity ids left')
    const entity = {
      id,
      name,
      skin: skin || text.stripColors(name),
      model,
      scale,
      level,
      pos: { x: toUnits(x), y: toUnits(y) + EYE, z: toUnits(z) },
      yaw,
      pitch,
      data
    }
    this.entities.set(id, entity)
    for (const p of level.players) if (p.spawned) p.showEntity(entity)
    return entity
  }

  removeEntity (entity) {
    if (!this.entities.has(entity.id)) return
    this.entities.delete(entity.id)
    for (const p of entity.level.players) if (p.spawned) p.hideEntity(entity.id)
    this._freeId(entity.id)
  }

  moveEntity (entity, x, y, z, yaw = entity.yaw, pitch = entity.pitch) {
    entity.pos = { x: toUnits(x), y: toUnits(y) + EYE, z: toUnits(z) }
    entity.yaw = yaw & 255
    entity.pitch = pitch & 255
    for (const p of entity.level.players) {
      if (p.spawned) p.conn.write('teleport', { id: entity.id, ...entity.pos, yaw: entity.yaw, pitch: entity.pitch })
    }
  }

  rotateEntity (entity, yaw, pitch = entity.pitch) {
    entity.yaw = yaw & 255
    entity.pitch = pitch & 255
    for (const p of entity.level.players) {
      if (p.spawned) p.conn.write('orientUpdate', { id: entity.id, yaw: entity.yaw, pitch: entity.pitch })
    }
  }

  updateEntity (entity) {
    for (const p of entity.level.players) {
      if (!p.spawned) continue
      p.hideEntity(entity.id)
      p.showEntity(entity)
    }
  }
}

// Players shown in the tab list (ExtPlayerList). Plugins can customize entries with the 'tabListEntry' event.
class TabList {
  constructor (server) { this.server = server }

  entryFor (target) {
    const ev = this.server.events.fire('tabListEntry', {
      player: target,
      listName: target.coloredName,
      groupName: `&fIn ${target.level ? target.level.name : '?'}`,
      groupRank: 0
    })
    return ev
  }

  _send (viewer, target) {
    if (!viewer.supports('ExtPlayerList') || !viewer.loggedIn) return
    if (target.hidden && viewer !== target && viewer.permission < target.permission) return
    const e = this.entryFor(target)
    viewer.conn.write('extAddPlayerName', {
      nameId: target === viewer ? -1 : target.id,
      playerName: target.name,
      listName: e.listName,
      groupName: e.groupName,
      groupRank: Math.max(0, Math.min(255, e.groupRank))
    })
  }

  addAllFor (viewer) {
    for (const target of this.server.players) {
      if (target !== viewer && target.loggedIn && target.level) this._send(viewer, target)
    }
  }

  update (target) {
    for (const viewer of this.server.players) this._send(viewer, target)
  }

  remove (target) {
    for (const viewer of this.server.players) {
      if (viewer.supports('ExtPlayerList') && viewer.loggedIn) viewer.conn.write('extRemovePlayerName', { nameId: target.id })
    }
  }
}

// The server console behaves like an all-powerful player for commands
class ConsolePlayer {
  constructor (server) {
    this.server = server
    this.isConsole = true
    this.name = '(console)'
    this.displayName = '&4Console'
    this.coloredName = '&4Console'
    this.color = '&4'
    this.permission = Infinity
    this.record = null
    this.data = {}
    this.loggedIn = true
  }

  get rank () { return this.server.ranks.highest }
  get level () { return this.server.levels.main }
  supports () { return false }
  message (msg) { if (msg) this.server.log.info(msg) }
}

function randomSalt (length) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = crypto.randomBytes(length)
  let s = ''
  for (let i = 0; i < length; i++) s += chars[bytes[i] % chars.length]
  return s
}

module.exports = { MCScriptServer, ConsolePlayer, TabList }
