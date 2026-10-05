'use strict'

const net = require('net')
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const { Connection } = require('./network/connection')
const { Player, toUnits, EYE } = require('./player')
const { EventBus } = require('./events')
const { Logger } = require('./util/logger')
const { Ranks } = require('./ranks')
const { createPlayerDB } = require('./storage/player-db')
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
const { modelPackets, effectPacket } = require('./cpe-extras')

const MAX_ENTITY_ID = 126

class MCScriptServer {
  constructor (config) {
    this.config = config
    this.root = config.root || process.cwd()
    this.version = require('../package.json').version
    this.log = new Logger({ dir: config.logToFile ? path.join(this.root, 'logs') : null, debug: config.debug, silent: config.silent })
    this.events = new EventBus(this.log)
    this.players = []
    this.entities = new Map() // non-player entities (bots/NPCs): id -> entity
    this.customModels = new Map() // name -> { id, model } (CustomModels)
    this.particleEffects = new Map() // name -> { id, effect } (CustomParticles)
    this._usedIds = new Set()
    this._connectionsPerIp = new Map()
    this.startedAt = Date.now()
    this.running = false

    for (const [code] of Object.entries(config.customColors || {})) text.extraColorCodes.add(code)

    const configDir = path.join(this.root, 'config')
    const dataDir = path.join(this.root, 'data')
    fs.mkdirSync(configDir, { recursive: true })
    fs.mkdirSync(dataDir, { recursive: true })

    this.ranks = new Ranks(path.join(configDir, 'ranks.json'), config.defaultRank)
    this.playerDB = createPlayerDB(dataDir, config.database, this.log)
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
    // classicube.net first, then any extra lists (betacraft.uk...) from config.extraHeartbeats
    this.heartbeats = [new Heartbeat(this, { url: config.heartbeatUrl, primary: true })]
    for (const extra of config.extraHeartbeats || []) {
      if (extra && extra.url) this.heartbeats.push(new Heartbeat(this, extra))
    }
    this.heartbeat = this.heartbeats[0]
    this.tabList = new TabList(this)
    this.console = new ConsolePlayer(this)
    this.CommandError = CommandError
    this.Blocks = Blocks
    this.text = text
    this.generators = generators
  }

  // A command sender without a body in the game whose messages go to `onMessage` (web panel, relays...).
  // It has console powers, unless `rank` is given: then it is limited to what that rank can do.
  createConsoleActor (name, onMessage, { rank = null, color = '&4' } = {}) {
    const actor = new ConsolePlayer(this)
    actor.name = name
    actor.displayName = actor.coloredName = `${color}${name}`
    actor.color = color
    actor.message = (msg) => onMessage(msg)
    if (rank) {
      const r = this.ranks.get(rank) || this.ranks.default
      Object.defineProperty(actor, 'rank', { value: r })
      actor.permission = r.permission
    }
    return actor
  }

  // Salt of the main server list (classicube.net)
  get salt () { return this.heartbeat.salt }

  // Persists changes made to server.config (e.g. by commands) to config/server.json
  saveConfig () { saveConfig(this.config) }

  // Global custom block definitions (id -> definition)
  get blockDefs () { return this.globalBlocks.data }

  // lifecycle

  async start () {
    const cfg = this.config
    this.log.info(`Starting &bMCScript ${this.version}&f (Node ${process.version})`)
    this.levels.initMain(cfg.mainLevel)
    registerCoreCommands(this)
    this.plugins.loadAll()
    for (const name of cfg.autoloadLevels || []) {
      try { if (!this.levels.get(name)) this.levels.load(name) } catch (err) { this.log.warn(`Could not autoload ${name}: ${err.message}`) }
    }

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
    // the heartbeat also registers the salt that name verification relies on
    if (cfg.public || cfg.verifyNames) for (const hb of this.heartbeats) hb.start()
    if (cfg.checkForUpdates) require('./update-check').checkForUpdates(this)
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
    for (const hb of this.heartbeats) hb.stop()
    this.plugins.unloadAll()
    this.levels.saveAll(true)
    if (this.playerDB.close) this.playerDB.close()
    else this.playerDB.flush()
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

  // connections

  _onConnection (socket) {
    if (!this.running) return socket.destroy()
    // stop a single address from filling every connection slot
    const ip = (socket.remoteAddress || '').replace(/^::ffff:/, '')
    const limit = this.config.maxConnectionsPerIp
    const count = this._connectionsPerIp.get(ip) || 0
    if (limit > 0 && count >= limit) {
      this.log.debug(`Refused connection from ${ip}: too many connections`)
      return socket.destroy()
    }
    this._connectionsPerIp.set(ip, count + 1)
    socket.once('close', () => {
      const n = (this._connectionsPerIp.get(ip) || 1) - 1
      if (n > 0) this._connectionsPerIp.set(ip, n)
      else this._connectionsPerIp.delete(ip)
    })
    const conn = new Connection(socket)
    conn.httpHandler = (method, target) => this._serveHttp(method, target)
    conn.on('socketError', err => this.log.debug(`Socket error (${conn.socketIp}): ${err.message}`))
    conn.on('handlerError', (err, packet) => this.log.error(`Error handling ${packet.name} from ${conn.socketIp}:`, err))
    // eslint-disable-next-line no-new
    new Player(this, conn)
  }

  // Texture packs in texpacks/ can be downloaded from the game port: http://host:port/texpacks/<file>
  _serveHttp (method, target) {
    if (method !== 'GET' && method !== 'HEAD') return null
    const m = String(target).split('?')[0].match(/^\/texpacks\/([A-Za-z0-9_.-]{1,48}\.(zip|png))$/)
    if (!m || m[1].startsWith('.')) return null
    const file = path.join(this.root, 'texpacks', m[1])
    try {
      const stat = fs.statSync(file)
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) return null
      return { type: m[2] === 'zip' ? 'application/zip' : 'image/png', body: fs.readFileSync(file) }
    } catch (err) {
      return null
    }
  }

  // URL players' clients use to download a pack from texpacks/ (needs publicAddress in the config)
  texturePackUrl (fileName, player = null) {
    let address = String(this.config.publicAddress || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
    // Pterodactyl tells us the address of the allocation, but it can be an internal one
    const panelIp = process.env.SERVER_IP
    if (!address && panelIp && panelIp !== '0.0.0.0' && !isPrivateIp(panelIp)) address = `${panelIp}:${this.port}`
    // a player on this machine or the same network can use the address they connected to. Not inside a panel's
    // container: there every player comes from the container network, and that address is useless to them
    const inPanel = Boolean(process.env.P_SERVER_UUID)
    if (!address && !inPanel && player && player.conn.localAddress && isPrivateIp(player.conn.socketIp)) {
      const ip = player.conn.localAddress
      address = `${ip.includes(':') ? `[${ip}]` : ip}:${this.port}`
    }
    if (!address) {
      if (!this._warnedTextureAddress) {
        this._warnedTextureAddress = true
        this.log.warn(`Texture pack ${fileName} can't be sent: set "publicAddress" in config/server.json to the address players join with (for example play.example.com:${this.port}).`)
      }
      return null
    }
    const host = /:\d+$/.test(address) ? address : `${address}:${this.port}`
    const url = `http://${host}/texpacks/${fileName}`
    if (this._loggedTextureUrl !== url) {
      this._loggedTextureUrl = url
      this.log.info(`Texture pack URL: ${url}`)
    }
    return url
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
    const joinMsg = (player.record && player.record.loginMessage) || 'joined the game'
    this.broadcast(`&a+ ${player.coloredName} &e${joinMsg}`, p => p !== player)
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
      const leaveMsg = (player.record && player.record.logoutMessage) || 'left the game'
      this.broadcast(`&c- ${player.coloredName} &e${leaveMsg}${why}`)
      this.log.info(`${player.name} disconnected${player.kickReason ? ' (' + player.kickReason + ')' : ''}`)
    }
  }

  // players

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
    record.rankHistory = [...(record.rankHistory || []), { from: from.name, to: rank.name, by: by || null, at: Date.now() }].slice(-20)
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

  // blocks

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
        const high = Buffer.alloc(64) // ExtendedBlocks: 2 extra bits per block
        part.forEach(([i, block], n) => {
          const b = p.convertBlock(block)
          indices.writeInt32BE(i, n * 4)
          blocks[n] = b & 0xFF
          high[n >> 2] |= ((b >> 8) & 3) << ((n & 3) * 2)
        })
        p.conn.write('bulkBlockUpdate', { count: part.length - 1, indices, blocks, high })
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

  // custom models & particles

  // Defines (or redefines) a custom model for every client that supports CustomModels v2.
  // Players and bots can then use it with /model <name>.
  defineModel (model) {
    const name = String(model.name || '').toLowerCase()
    if (!/^[a-z0-9_.-]{1,64}$/.test(name)) throw new Error('Invalid model name')
    let entry = this.customModels.get(name)
    if (!entry) {
      const used = new Set([...this.customModels.values()].map(e => e.id))
      let id = 0
      while (used.has(id)) id++
      if (id > 63) throw new Error('Too many custom models (max 64)')
      entry = { id }
      this.customModels.set(name, entry)
    }
    entry.model = { ...model, name }
    for (const p of this.players) if (p.loggedIn) p.sendCustomModel(entry)
    return entry
  }

  removeModel (name) {
    const entry = this.customModels.get(String(name).toLowerCase())
    if (!entry) return false
    this.customModels.delete(String(name).toLowerCase())
    for (const p of this.players) if (p.loggedIn && p.supports('CustomModels', 2)) p.conn.write('undefineModel', { modelId: entry.id })
    return true
  }

  _modelPackets (entry) { return modelPackets(entry.id, entry.model) }

  // Registers a named particle effect (see lib/cpe-extras.js for the fields)
  defineParticle (name, effect) {
    name = String(name).toLowerCase()
    let entry = this.particleEffects.get(name)
    if (!entry) {
      if (this.particleEffects.size >= 255) throw new Error('Too many particle effects')
      entry = { id: this.particleEffects.size }
      this.particleEffects.set(name, entry)
    }
    entry.effect = effect
    entry.version = (entry.version || 0) + 1
    return entry
  }

  // Shows a particle effect at a position (blocks) to the players in a level
  spawnParticles (level, name, x, y, z, origin = null) {
    const entry = this.particleEffects.get(String(name).toLowerCase())
    if (!entry) throw new Error(`Unknown particle effect ${name}`)
    for (const p of this.players) {
      if (p.level !== level || !p.spawned || !p.supports('CustomParticles')) continue
      const sent = p.data._effects || (p.data._effects = new Map())
      if (sent.get(entry.id) !== entry.version) {
        p.conn.write('defineEffect', effectPacket(entry.id, entry.effect))
        sent.set(entry.id, entry.version)
      }
      const o = origin || { x, y: y - 1, z }
      p.conn.write('spawnEffect', {
        effectId: entry.id,
        x: Math.round(x * 32),
        y: Math.round(y * 32),
        z: Math.round(z * 32),
        originX: Math.round(o.x * 32),
        originY: Math.round(o.y * 32),
        originZ: Math.round(o.z * 32)
      })
    }
  }

  // entities (bots / NPCs)

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

// loopback, private ranges (10/8, 172.16/12, 192.168/16, 100.64/10) and IPv6 local addresses
function isPrivateIp (ip) {
  if (!ip) return false
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true
  return /^f[cd]/i.test(ip) || /^fe80:/i.test(ip)
}

module.exports = { MCScriptServer, ConsolePlayer, TabList }
