'use strict'

const zlib = require('zlib')
const { EventEmitter } = require('events')
const { EXTENSIONS } = require('./protocol/packets')
const Blocks = require('./blocks')
const text = require('./util/text')
const { ENV_COLORS, ENV_PROPS } = require('./level/level')
const { mojangHasJoined } = require('./heartbeat')

const MESSAGE_TYPES = {
  chat: 0,
  status1: 1,
  status2: 2,
  status3: 3,
  bottom1: 11,
  bottom2: 12,
  bottom3: 13,
  announce: 100,
  bigAnnounce: 101,
  smallAnnounce: 102
}

const NOTIFY_ACTIONS = ['blockListSelected', 'blockListToggled', 'levelSaved', 'respawned', 'spawnUpdated', 'texturePackChanged', 'texturePromptResponded', 'thirdPersonChanged']

const NAME_RE = /^[A-Za-z0-9_.]{1,16}$/
// names that would clash with JavaScript object internals when used as keys
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype', 'console'])
const SELF = -1

// Positions are kept in protocol units: 1 block = 32 units, and y is the eye position (feet + 51).
const EYE = 51

function toUnits (blocks) { return Math.round(blocks * 32) }

class Player extends EventEmitter {
  constructor (server, conn) {
    super()
    this.server = server
    this.conn = conn
    this.ip = server.config.trustProxy && conn.forwardedFor ? conn.forwardedFor : conn.socketIp
    this.name = null
    this.id = null // entity id seen by other players
    this.level = null
    this.pos = { x: 0, y: 0, z: 0 }
    this.yaw = 0
    this.pitch = 0
    this.heldBlock = 1
    this.cpe = false
    this.appName = 'Unknown'
    this.extensions = new Map()
    this.customBlocksLevel = 0
    this.spawned = false
    this.loggedIn = false
    this.loadingLevel = false
    this.record = null
    this.joinedAt = Date.now()
    this.lastActivity = Date.now()
    this.partialMessage = ''
    this.selection = null
    this.sentBlockDefs = new Map()
    this.blockTable = new Uint16Array(Blocks.MAX_BLOCK + 1)
    this.frozen = false
    this.hidden = false
    this.data = {} // scratch space for plugins (not saved)
    this.pingMs = null
    this._pingSent = new Map()
    this.isConsole = false

    conn.on('identification', p => this._onIdentification(p).catch(err => {
      this.server.log.error('Login error:', err)
      this.kick('Login failed')
    }))
    conn.on('close', () => this.server._onPlayerDisconnect(this))
    this._loginTimeout = setTimeout(() => { if (!this.loggedIn) this.kick('Login timed out') }, 15000)
    this._loginTimeout.unref()
  }

  // identity & rank

  get rank () {
    return (this.record && this.server.ranks.get(this.record.rank)) || this.server.ranks.default
  }

  get permission () { return this.rank.permission }

  get color () { return (this.record && this.record.color) || this.rank.color }

  get displayName () {
    const r = this.record || {}
    const title = r.title ? `${r.titleColor || this.color}[${r.title}${r.titleColor || this.color}] ` : ''
    return `${this.rank.prefix || ''}${title}${this.color}${r.nick || this.name}`
  }

  get coloredName () { return `${this.color}${(this.record && this.record.nick) || this.name}` }

  // CPE helpers

  supports (ext, version = 1) {
    return (this.extensions.get(ext) || 0) >= version
  }

  // login

  async _onIdentification (packet) {
    if (this.name) return this.kick('Already identified')
    const server = this.server
    const cfg = server.config

    this.ip = cfg.trustProxy && this.conn.forwardedFor ? this.conn.forwardedFor : this.conn.socketIp
    if (this.conn.isWebSocket && !cfg.allowWebClient) return this.kick('The web client is not allowed on this server')
    if (packet.protocolVersion !== 7) return this.kick('Unsupported protocol version, please update your client')
    if (!NAME_RE.test(packet.username) || RESERVED_NAMES.has(packet.username.toLowerCase())) return this.kick('Invalid username')
    this.name = packet.username

    // skins are looked up by the account name, before any suffix is added
    this.skinName = this.name
    if (cfg.verifyNames && !this._isLocalIp()) {
      const list = await this._verify(packet.key)
      if (this.conn.closed) return
      if (!list) {
        server.log.info(`${this.name} (${this.ip}) failed name verification`)
        return this.kick('Login failed! Close the game and sign in again.')
      }
      this.verifiedVia = list.label
      // a suffix keeps accounts from different lists apart (e.g. "Notch" on BetaCraft vs ClassiCube)
      if (list.nameSuffix) this.name += list.nameSuffix
      this.skinName = list.skinPrefix + this.skinName
    }

    const connecting = server.events.fire('playerConnecting', { name: this.name, ip: this.ip, player: this })
    if (connecting.cancelled) return this.kick(connecting.cancelReason || 'You are not allowed to join')

    this.record = server.playerDB.getOrCreate(this.name)
    if (cfg.owners.some(o => o.toLowerCase() === this.name.toLowerCase()) && this.rank !== server.ranks.highest) {
      this.record.rank = server.ranks.highest.name
    }
    if (this.permission < 0) return this.kick('You are banned from this server')

    const existing = server.findPlayerExact(this.name)
    if (existing) existing.kick('Someone else logged in as you')

    const online = server.players.filter(p => p.loggedIn && p !== existing).length
    if (online >= cfg.maxPlayers && this.permission < server.ranks.permissionOf('Operator')) {
      return this.kick('The server is full, try again later')
    }

    if (packet.padding === 0x42) await this._negotiateCPE()
    this.conn.fullCP437 = this.supports('FullCP437')
    // from now on these change the size of several packets in both directions
    this.conn.extBlocks = this.supports('ExtendedBlocks')
    this.conn.extPos = this.supports('ExtEntityPositions')

    if (this.supports('CustomBlocks')) {
      this.conn.write('customBlockSupportLevel', { level: 1 })
      await this._waitFor('customBlockSupportLevel', 5000).then(p => { this.customBlocksLevel = p ? p.level : 0 })
    }

    clearTimeout(this._loginTimeout)
    this.loggedIn = true
    this.record.logins++
    this.record.lastLogin = Date.now()
    this.record.lastIp = this.ip
    this.record.name = this.name
    if (!this.record.ips.includes(this.ip)) this.record.ips.push(this.ip)
    server.playerDB.save()

    this._bindPackets()
    server._addPlayer(this)
    if (this.id === null) return
    server.log.info(`${this.name} [${this.ip}${this.conn.isWebSocket ? ', web' : ''}] connected using ${this.appName}`)

    this._sendIdentification(server.levels.main)
    this._sendTextColors()
    for (const entry of server.customModels.values()) this.sendCustomModel(entry)

    const ok = this.changeLevel(server.levels.main, { initial: true })
    if (!ok) return
    this._startPing()
    server._onPlayerJoin(this)
  }

  // Returns the server list (heartbeat) that vouches for this player's name, or null
  async _verify (mppass) {
    const key = String(mppass || '').toLowerCase().replace(/^0+/, '')
    const lists = this.server.heartbeats
    for (const list of lists) {
      if (key && list.mppassFor(this.name).replace(/^0+/, '') === key) return list
    }
    // BetaCraft players log in with a Minecraft account instead of an mppass
    const mojangList = lists.find(l => l.mojangAuth)
    if (!mojangList) return null
    try {
      if (await mojangHasJoined(this.name, this.ip)) return mojangList
    } catch (err) {
      this.server.log.warn(`Could not check ${this.name} with Mojang: ${err.message}`)
    }
    return null
  }

  // Connections from this machine (without a proxy in between) skip name verification
  _isLocalIp () {
    const ip = this.conn.socketIp
    return (ip === '127.0.0.1' || ip === '::1') && !this.conn.forwardedFor
  }

  _waitFor (packetName, timeout) {
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.conn.off(packetName, handler); resolve(null) }, timeout)
      const handler = (p) => { clearTimeout(timer); resolve(p) }
      this.conn.once(packetName, handler)
    })
  }

  _negotiateCPE () {
    this.cpe = true
    const exts = Object.entries(EXTENSIONS)
    this.conn.write('extInfo', { appName: `MCScript ${this.server.version}`, count: exts.length })
    for (const [extName, version] of exts) this.conn.write('extEntry', { extName, version })

    return new Promise(resolve => {
      let expected = null
      const timer = setTimeout(done, 10000)
      const onInfo = (p) => {
        this.appName = p.appName
        expected = p.count
        if (expected === 0) done()
      }
      const onEntry = (p) => {
        if (EXTENSIONS[p.extName] !== undefined) this.extensions.set(p.extName, Math.min(p.version, EXTENSIONS[p.extName]))
        if (expected !== null && --expected <= 0) done()
      }
      const conn = this.conn
      conn.on('extInfo', onInfo)
      conn.on('extEntry', onEntry)
      function done () {
        clearTimeout(timer)
        conn.off('extInfo', onInfo)
        conn.off('extEntry', onEntry)
        resolve()
      }
    })
  }

  _sendIdentification (level) {
    const cfg = this.server.config
    const motd = level && level.motd && level.motd !== 'ignore' ? level.motd : cfg.motd
    this.conn.write('serverIdentification', {
      protocolVersion: 7,
      serverName: cfg.name,
      motd,
      userType: this.server.blockPerms.canDelete(this, 7) ? 0x64 : 0x00
    })
  }

  _sendTextColors () {
    if (!this.supports('TextColors')) return
    for (const [code, hex] of Object.entries(this.server.config.customColors || {})) {
      const n = parseInt(String(hex).replace('#', ''), 16)
      this.conn.write('setTextColor', { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255, code: code.charCodeAt(0) })
    }
  }

  _startPing () {
    this._pingTimer = setInterval(() => {
      if (this.conn.closed) return clearInterval(this._pingTimer)
      if (this.supports('TwoWayPing')) {
        const id = (Math.random() * 30000) | 0
        this._pingSent.set(id, Date.now())
        this.conn.write('twoWayPing', { direction: 1, data: id })
      } else {
        this.conn.write('ping')
      }
    }, 5000)
    this._pingTimer.unref()
  }

  _bindPackets () {
    const conn = this.conn
    conn.on('position', p => this._onPosition(p))
    conn.on('setBlock', p => this._onSetBlock(p))
    conn.on('message', p => this._onMessage(p))
    conn.on('playerClicked', p => this._onClick(p))
    conn.on('pluginMessage', p => {
      this.server.events.fire('pluginMessage', { player: this, channel: p.channel, data: p.data })
    })
    conn.on('notifyAction', p => {
      this.server.events.fire('notifyAction', { player: this, action: NOTIFY_ACTIONS[p.action] || p.action, value: p.value })
    })
    conn.on('notifyPositionAction', p => {
      const action = p.action === 3 ? 'respawned' : p.action === 4 ? 'spawnUpdated' : p.action
      this.server.events.fire('notifyAction', { player: this, action, position: { x: p.x, y: p.y, z: p.z } })
    })
    conn.on('twoWayPing', p => {
      if (p.direction === 0) {
        conn.write('twoWayPing', { direction: 0, data: p.data })
      } else if (this._pingSent.has(p.data)) {
        this.pingMs = Date.now() - this._pingSent.get(p.data)
        this._pingSent.delete(p.data)
      }
    })
  }

  // messages

  message (msg, type = 'chat') {
    if (!this.loggedIn || this.conn.closed) return
    const typeId = MESSAGE_TYPES[type] ?? type
    if (typeId !== 0) {
      if (!this.supports('MessageTypes')) {
        if (typeId >= 100) this.message(msg)
        return
      }
      this.conn.write('message', { type: typeId, message: text.sanitize(String(msg)).slice(0, 64) })
      return
    }
    for (const line of String(msg).split('\n')) {
      for (const part of text.wrap(line)) this.conn.write('message', { type: 0, message: part })
    }
  }

  kick (reason = 'Kicked') {
    this.kickReason = reason
    this.conn.kick(reason)
  }

  // levels & spawning

  // Moves the player to another level. Returns false if prevented.
  changeLevel (level, opts = {}) {
    const server = this.server
    const from = this.level
    if (!opts.initial && !opts.force) {
      if (from === level) { this.message('&cYou are already in that level.'); return false }
      if (this.permission < server.ranks.permissionOf(level.visitRank)) {
        this.message(`&cYou are not allowed to visit ${level.name}.`)
        return false
      }
      if (level.needsExtPositions && !this.conn.extPos) {
        this.message(`&c${level.name} is too big for your client (update to the latest ClassiCube).`)
        return false
      }
      const ev = server.events.fire('playerChangeLevel', { player: this, from, to: level })
      if (ev.cancelled) { if (ev.cancelReason) this.message(ev.cancelReason); return false }
    }

    if (from) {
      for (const other of server.players) {
        if (other === this || other.level !== from || !other.spawned) continue
        other.hideEntity(this.id)
        this.hideEntity(other.id)
      }
      for (const e of server.entitiesIn(from)) this.hideEntity(e.id)
    }

    if (from && !opts.keepPosition) this.rememberPosition()
    const at = opts.keepPosition ? { ...this.feetPos, yaw: this.yaw, pitch: this.pitch } : level.spawn
    if (!opts.keepPosition) this._movedByServer()
    this.spawned = false
    this.level = level
    if (this.selection && from !== level) this.cancelSelection()
    if (this.supports('InstantMOTD') && from) this._sendIdentification(level)
    this._sendLevel(level)
    this.spawn(at)

    server.tabList.update(this)
    server.events.fire('playerSpawn', { player: this, level, from })
    if (from && !opts.silent && from !== level) {
      server.broadcast(`${this.coloredName} &ewent to &f${level.name}`, p => p.level === level || p.level === from)
    }
    return true
  }

  // Re-sends the current level keeping the player's position
  reloadLevel () {
    return this.changeLevel(this.level, { force: true, silent: true, keepPosition: true })
  }

  // Recalculates which block ids this client understands
  _updateBlockTable () {
    const level = this.level
    const cpeBlocks = this.customBlocksLevel >= 1
    const defs = this.supports('BlockDefinitions')
    const maxId = this.conn.extBlocks ? Blocks.MAX_BLOCK : 255
    for (let id = 0; id <= Blocks.MAX_BLOCK; id++) {
      let b = id
      if (id > Blocks.MAX_CPE) {
        const def = level && level.getBlockDef(id)
        b = def ? (defs && id <= maxId ? id : def.fallback) : 1
      } else if (id > Blocks.MAX_CLASSIC && !cpeBlocks) {
        b = Blocks.CPE_FALLBACK[id]
      }
      if (b > Blocks.MAX_CLASSIC && b <= Blocks.MAX_CPE && !cpeBlocks) b = Blocks.CPE_FALLBACK[b]
      this.blockTable[id] = b
    }
  }

  // Highest block id this client understands
  get maxBlockId () { return this.conn.extBlocks ? Blocks.MAX_BLOCK : 255 }

  convertBlock (id) { return this.blockTable[id] }

  // Sends (or removes) custom block definitions so the client matches the current level
  sendBlockDefinitions () {
    if (!this.supports('BlockDefinitions') || !this.level) return
    const useExt = this.supports('BlockDefinitionsExt', 2)
    for (let id = 1; id <= this.maxBlockId; id++) {
      const def = this.level.getBlockDef(id)
      const key = def ? JSON.stringify(def) : null
      if (this.sentBlockDefs.get(id) === key) continue
      if (def) {
        const [name, data] = Blocks.definitionPacket(def, useExt)
        this.conn.write(name, data)
        this.sentBlockDefs.set(id, key)
      } else if (this.sentBlockDefs.has(id)) {
        this.conn.write('removeBlockDefinition', { block: id })
        this.sentBlockDefs.delete(id)
      }
    }
    this._updateBlockTable()
  }

  _sendLevel (level) {
    this.loadingLevel = true
    this._updateBlockTable()
    this.sendBlockDefinitions()

    const conn = this.conn
    const fast = this.supports('FastMap')
    const { lower, upper } = level.serializeForClient(this.blockTable)
    const compress = data => fast ? zlib.deflateRawSync(data.subarray(4), { level: 5 }) : zlib.gzipSync(data, { level: 5 })
    if (fast) conn.write('levelInitializeFast', { volume: level.volume })
    else conn.write('levelInitialize')

    // With ExtendedBlocks the "percent" byte tells the client which array a chunk belongs to
    // (0 = lower 8 bits, anything else = upper bits), so it can't be used for progress.
    const sendArray = (data, isUpper) => {
      const compressed = compress(data)
      const total = compressed.length
      for (let i = 0; i < total; i += 1024) {
        const chunk = compressed.subarray(i, Math.min(i + 1024, total))
        const percent = conn.extBlocks ? (isUpper ? 1 : 0) : Math.min(100, Math.floor((i + chunk.length) / total * 100))
        conn.write('levelDataChunk', { length: chunk.length, data: chunk, percent })
      }
    }
    sendArray(lower, false)
    if (upper && conn.extBlocks) sendArray(upper, true)
    conn.write('levelFinalize', { x: level.width, y: level.height, z: level.length })
    this.loadingLevel = false

    this.sendEnv()
    this.sendBlockPermissions()
  }

  // Environment: colors, texture pack, weather and map properties
  sendEnv () {
    const level = this.level
    if (!level) return
    const env = level.resolvedEnv()
    if (this.supports('EnvColors')) {
      ENV_COLORS.forEach((key, variable) => {
        const hex = env[key]
        if (hex) {
          const n = parseInt(hex, 16)
          this.conn.write('envSetColor', { variable, r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 })
        } else {
          this.conn.write('envSetColor', { variable, r: -1, g: -1, b: -1 })
        }
      })
    }
    if (this.supports('EnvMapAspect')) {
      const url = env.texture || this.server.config.defaultTexture || ''
      this.conn.write('setMapEnvUrl', { url })
      for (const [key, type] of Object.entries(ENV_PROPS)) {
        let value = env[key]
        if (key === 'cloudsSpeed' || key === 'weatherSpeed') value = Math.round(value * 256)
        else if (key === 'weatherFade') value = Math.round(value * 128)
        else if (key === 'skyboxHorSpeed' || key === 'skyboxVerSpeed') value = Math.round(value * 1024)
        else if (key === 'expFog') value = value ? 1 : 0
        else if (key === 'sideBlock' || key === 'edgeBlock') value = this.convertBlock(value)
        this.conn.write('setMapEnvProperty', { type, value })
      }
    }
    if (this.supports('EnvWeatherType')) this.conn.write('envSetWeatherType', { weather: env.weather })
    if (this.supports('LightingMode') && env.lighting !== null && env.lighting !== undefined) {
      this.conn.write('lightingMode', { mode: env.lighting, locked: 0 })
    }
  }

  sendBlockPermissions () {
    if (!this.supports('BlockPermissions') || !this.level) return
    const canBuild = this.level.canBuild(this)
    for (let id = 1; id <= this.maxBlockId; id++) {
      if (id > Blocks.MAX_CPE && !this.level.getBlockDef(id)) continue
      if (id > Blocks.MAX_CLASSIC && id <= Blocks.MAX_CPE && this.customBlocksLevel < 1) continue
      this.conn.write('setBlockPermission', {
        block: id,
        allowPlace: canBuild && this.server.blockPerms.canPlace(this, id) ? 1 : 0,
        allowDelete: canBuild && this.server.blockPerms.canDelete(this, id) ? 1 : 0
      })
    }
  }

  // Spawns the player at a position given in blocks (feet position)
  spawn (at) {
    const server = this.server
    const level = this.level
    this.pos = { x: toUnits(at.x), y: toUnits(at.y) + EYE, z: toUnits(at.z) }
    this.yaw = at.yaw || 0
    this.pitch = at.pitch || 0

    this.showEntity({ ...this.entityInfo(), id: SELF })
    this.spawned = true

    for (const other of server.players) {
      if (other === this || other.level !== level || !other.spawned) continue
      if (!this.hidden) other.showEntity(this.entityInfo())
      if (!other.hidden) this.showEntity(other.entityInfo())
    }
    for (const e of server.entitiesIn(level)) this.showEntity(e)
  }

  entityInfo () {
    const r = this.record || {}
    return {
      id: this.id,
      name: this.displayName,
      listName: this.name,
      skin: r.skin || this.skinName || this.name,
      model: this.currentModel || r.model || 'humanoid',
      scale: this.data.modelScale || null,
      rotation: this.data.entityRotation || null,
      pos: this.pos,
      yaw: this.yaw,
      pitch: this.pitch
    }
  }

  // Shows an entity (another player or a bot) to this player
  showEntity (e) {
    if (e.id === null || e.id === undefined) return
    const name = e.name.slice(0, 64)
    if (this.supports('ExtPlayerList', 2)) {
      this.conn.write('extAddEntity2', { id: e.id, entityName: name, skin: e.skin || e.listName || name, x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: e.yaw, pitch: e.pitch })
    } else {
      this.conn.write('spawnPlayer', { id: e.id, entityName: name, x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: e.yaw, pitch: e.pitch })
    }
    if (e.model && e.model !== 'humanoid' && this.supports('ChangeModel')) {
      this.conn.write('changeModel', { id: e.id, model: e.model })
    }
    if (e.scale && this.supports('EntityProperty')) {
      for (const type of [3, 4, 5]) this.conn.write('setEntityProperty', { id: e.id, type, value: Math.round(e.scale * 1000) })
    }
    if (e.rotation && this.supports('EntityProperty')) {
      e.rotation.forEach((deg, type) => { if (deg) this.conn.write('setEntityProperty', { id: e.id, type, value: Math.round(deg) }) })
    }
  }

  hideEntity (id) {
    if (id === null || id === undefined) return
    this.conn.write('despawnPlayer', { id })
  }

  // Teleports the player to a position in blocks (feet position)
  // Saved before teleports and level changes so /back can return here
  rememberPosition () {
    if (!this.level || !this.spawned) return
    this.previousPosition = { level: this.level.name, ...this.feetPos, yaw: this.yaw, pitch: this.pitch }
  }

  teleport (x, y, z, yaw = this.yaw, pitch = this.pitch) {
    this.rememberPosition()
    this._movedByServer()
    this.pos = { x: toUnits(x), y: toUnits(y) + EYE, z: toUnits(z) }
    this.yaw = yaw & 255
    this.pitch = pitch & 255
    this.conn.write('teleport', { id: SELF, ...this.pos, yaw: this.yaw, pitch: this.pitch })
    this._broadcastMovement(null, true)
  }

  teleportTo (other) {
    if (other.level !== this.level) {
      if (!this.changeLevel(other.level)) return false
    } else {
      this.rememberPosition()
    }
    this.pos = { ...other.pos }
    this.yaw = other.yaw
    this.pitch = other.pitch
    this.conn.write('teleport', { id: SELF, ...this.pos, yaw: this.yaw, pitch: this.pitch })
    this._broadcastMovement(null, true)
    return true
  }

  // Current position in whole blocks (feet)
  get blockPos () {
    return {
      x: Math.floor(this.pos.x / 32),
      y: Math.floor((this.pos.y - EYE) / 32),
      z: Math.floor(this.pos.z / 32)
    }
  }

  // Exact feet position in blocks
  get feetPos () {
    return { x: this.pos.x / 32, y: (this.pos.y - EYE) / 32, z: this.pos.z / 32 }
  }

  // persist = false for temporary changes (e.g. zombies in a minigame)
  setModel (model, persist = true) {
    if (persist) {
      this.record.model = model === 'humanoid' ? null : model
      this.server.playerDB.save()
    }
    this.currentModel = model
    for (const p of this.server.players) {
      if (p.level !== this.level || !p.spawned || !p.supports('ChangeModel')) continue
      p.conn.write('changeModel', { id: p === this ? SELF : this.id, model })
    }
  }

  setSkin (skin) {
    this.record.skin = skin || null
    this.server.playerDB.save()
    this.respawnForOthers()
  }

  // Re-sends this player's entity to everyone else (after name/skin changes)
  respawnForOthers () {
    for (const p of this.server.players) {
      if (p === this || p.level !== this.level || !p.spawned) continue
      p.hideEntity(this.id)
      if (!this.hidden) p.showEntity(this.entityInfo())
    }
    this.server.tabList.update(this)
  }

  // CPE features

  holdBlock (block, lock = false) {
    if (this.supports('HeldBlock')) this.conn.write('holdThis', { block: this.convertBlock(block), preventChange: lock ? 1 : 0 })
  }

  setHotbar (block, index) {
    if (this.supports('SetHotbar')) this.conn.write('setHotbar', { block: this.convertBlock(block), index })
  }

  setReach (blocks) {
    if (this.supports('ClickDistance')) this.conn.write('setClickDistance', { distance: Math.round(blocks * 32) })
    this.data.reach = blocks
  }

  setHacks ({ flying = true, noClip = true, speeding = true, spawnControl = true, thirdPerson = true, jumpHeight = -1 } = {}) {
    if (!this.supports('HackControl')) return
    const b = v => v ? 1 : 0
    this.conn.write('hackControl', { flying: b(flying), noClip: b(noClip), speeding: b(speeding), spawnControl: b(spawnControl), thirdPerson: b(thirdPerson), jumpHeight })
  }

  setVelocity (x, y, z, { addX = false, addY = false, addZ = false } = {}) {
    if (!this.supports('VelocityControl')) return false
    this.conn.write('velocityControl', {
      x: Math.round(x * 10000),
      y: Math.round(y * 10000),
      z: Math.round(z * 10000),
      modeX: addX ? 0 : 1,
      modeY: addY ? 0 : 1,
      modeZ: addZ ? 0 : 1
    })
    return true
  }

  setSpawnpoint (x, y, z, yaw = 0, pitch = 0) {
    if (this.supports('SetSpawnpoint')) this.conn.write('setSpawnpoint', { x: toUnits(x), y: toUnits(y) + EYE, z: toUnits(z), yaw, pitch })
  }

  // Draws a translucent box (SelectionCuboid). Coordinates are block corners (inclusive).
  showSelection (id, label, p1, p2, color = [255, 255, 255, 100]) {
    if (!this.supports('SelectionCuboid')) return false
    this.conn.write('makeSelection', {
      id,
      label,
      x1: Math.min(p1.x, p2.x),
      y1: Math.min(p1.y, p2.y),
      z1: Math.min(p1.z, p2.z),
      x2: Math.max(p1.x, p2.x) + 1,
      y2: Math.max(p1.y, p2.y) + 1,
      z2: Math.max(p1.z, p2.z) + 1,
      r: color[0],
      g: color[1],
      b: color[2],
      a: color[3] ?? 100
    })
    return true
  }

  hideSelection (id) {
    if (this.supports('SelectionCuboid')) this.conn.write('removeSelection', { id })
  }

  sendCustomModel (entry) {
    if (!this.supports('CustomModels', 2)) return
    for (const [name, data] of this.server._modelPackets(entry)) this.conn.write(name, data)
  }

  // Custom data for client plugins (PluginMessages): up to 64 bytes per message
  sendPluginMessage (channel, data) {
    if (!this.supports('PluginMessages')) return false
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data))
    this.conn.write('pluginMessage', { channel, data: buf.subarray(0, 64) })
    return true
  }

  // Cinematic bars and hiding parts of the HUD (CinematicGui). barSize from 0 to 1.
  setCinematic ({ hideCrosshair = false, hideHand = false, hideHotbar = false, color = [0, 0, 0, 255], barSize = 0 } = {}) {
    if (!this.supports('CinematicGui')) return false
    this.conn.write('cinematicGui', {
      hideCrosshair: hideCrosshair ? 1 : 0,
      hideHand: hideHand ? 1 : 0,
      hideHotbar: hideHotbar ? 1 : 0,
      r: color[0],
      g: color[1],
      b: color[2],
      a: color[3] ?? 255,
      barSize: Math.round(Math.max(0, Math.min(1, barSize)) * 65535)
    })
    return true
  }

  // Opens or closes the block inventory (ToggleBlockList)
  toggleBlockList (open = true) {
    if (!this.supports('ToggleBlockList')) return false
    this.conn.write('toggleBlockList', { close: open ? 0 : 1 })
    return true
  }

  setTextHotKey (label, action, keyCode, keyMods = 0) {
    if (this.supports('TextHotKey')) this.conn.write('setTextHotKey', { label, action, keyCode, keyMods })
  }

  // Ask the player to mark `count` blocks (placing or breaking). Resolves with [{x, y, z, block}]
  selectBlocks (count, label = 'Selection') {
    if (this.selection) this.selection.reject(new Error('Selection replaced'))
    return new Promise((resolve, reject) => {
      this.selection = { count, marks: [], label, resolve, reject }
      this.message(`&ePlace or break &f${count}&e block${count > 1 ? 's' : ''} to mark ${count > 1 ? 'the corners' : 'the position'}. &7(/abort to cancel)`)
    })
  }

  // Adds a position to the current selection (clicking a block, or /mark)
  addMark (x, y, z, block = this.level.getBlock(x, y, z)) {
    const sel = this.selection
    if (!sel) return false
    sel.marks.push({ x, y, z, block })
    if (sel.marks.length === 1 && sel.count > 1) {
      this.showSelection(250, sel.label, sel.marks[0], sel.marks[0], [255, 255, 0, 120])
      this.message(`&eMarked &f(${x}, ${y}, ${z})&e. Mark the second position.`, 'status3')
    }
    if (sel.marks.length >= sel.count) {
      this.selection = null
      this.hideSelection(250)
      this.message('', 'status3')
      sel.resolve(sel.marks)
    }
    return true
  }

  cancelSelection () {
    if (!this.selection) return false
    const sel = this.selection
    this.selection = null
    this.hideSelection(250)
    sel.reject(Object.assign(new Error('Selection cancelled'), { cancelled: true }))
    return true
  }

  // incoming packets

  // The client keeps sending where it was until it gets the teleport (or the new level), so for a
  // moment packets from the old spot are still arriving. Remember that spot to drop them.
  _movedByServer () {
    if (this.pos && this.spawned) this._staleFrom = { pos: this.pos, until: Date.now() + 2000 }
  }

  _isStale (p) {
    const stale = this._staleFrom
    if (!stale) return false
    const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z))
    if (Date.now() > stale.until || dist(p, this.pos) <= 64) {
      this._staleFrom = null // the client caught up (or it's been long enough)
      return false
    }
    return dist(p, stale.pos) <= 128
  }

  _onPosition (p) {
    if (!this.spawned || this.loadingLevel) return
    if (this._isStale(p)) return
    this.lastActivity = Date.now()
    if (this.supports('HeldBlock')) this.heldBlock = p.heldBlock

    const from = this.pos
    const to = { x: p.x, y: p.y, z: p.z }
    const moved = from.x !== to.x || from.y !== to.y || from.z !== to.z
    const rotated = this.yaw !== p.yaw || this.pitch !== p.pitch
    if (!moved && !rotated) return

    if (this.frozen && moved) {
      this.conn.write('teleport', { id: SELF, ...from, yaw: p.yaw, pitch: p.pitch })
      return
    }

    if (moved) {
      const level = this.level
      const ev = this.server.events.fire('playerMove', { player: this, from, to, yaw: p.yaw, pitch: p.pitch })
      if (ev.cancelled) {
        this.conn.write('teleport', { id: SELF, ...from, yaw: p.yaw, pitch: p.pitch })
        return
      }
      if (this.level !== level || this.pos !== from) return // a handler teleported the player
    }
    const old = this.pos
    this.pos = to
    this.yaw = p.yaw
    this.pitch = p.pitch
    this._broadcastMovement(old, false)
  }

  _broadcastMovement (old, teleport) {
    if (this.hidden || !this.spawned) return
    const pos = this.pos
    let packet
    if (!teleport && old) {
      const dx = pos.x - old.x; const dy = pos.y - old.y; const dz = pos.z - old.z
      const fits = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) <= 127
      if (fits) packet = ['posAndOrientUpdate', { id: this.id, dx, dy, dz, yaw: this.yaw, pitch: this.pitch }]
    }
    if (!packet) packet = ['teleport', { id: this.id, ...pos, yaw: this.yaw, pitch: this.pitch }]
    for (const other of this.server.players) {
      if (other === this || other.level !== this.level || !other.spawned) continue
      other.conn.write(packet[0], packet[1])
    }
  }

  _revertBlock (x, y, z) {
    if (this.level && this.level.inBounds(x, y, z)) {
      this.conn.write('setBlock', { x, y, z, block: this.convertBlock(this.level.getBlock(x, y, z)) })
    }
  }

  _onSetBlock (p) {
    if (!this.spawned || this.loadingLevel) return
    this.lastActivity = Date.now()
    const { x, y, z } = p
    const level = this.level
    const server = this.server
    if (!level.inBounds(x, y, z)) return

    const placing = p.mode === 1
    const oldBlock = level.getBlock(x, y, z)
    let block = placing ? p.block : 0

    // selection mode (used by /cuboid, /zone, ...)
    if (this.selection) {
      this._revertBlock(x, y, z)
      this.addMark(x, y, z, placing ? p.block : oldBlock)
      return
    }

    // distance check (reach + tolerance) to stop hacked clients from building far away
    const eye = { x: this.pos.x / 32, y: (this.pos.y) / 32, z: this.pos.z / 32 }
    const reach = (this.data.reach || server.config.maxClickDistance) + 4
    if (Math.hypot(eye.x - x - 0.5, eye.y - y - 0.5, eye.z - z - 0.5) > reach) {
      return this._revertBlock(x, y, z)
    }

    if (placing && !level.isValidBlock(block)) return this._revertBlock(x, y, z)

    // Plugins (e.g. minigames) may override the permission decision through 'blockPermission'
    let denied = null
    if (!level.canBuild(this)) denied = `&cYou are not allowed to build in ${level.name}.`
    else if (placing ? !server.blockPerms.canPlace(this, block) : !server.blockPerms.canDelete(this, oldBlock)) {
      denied = `&cYou can't ${placing ? 'place' : 'delete'} ${level.blockName(placing ? block : oldBlock)}.`
    }
    const perm = server.events.fire('blockPermission', { player: this, level, x, y, z, oldBlock, block, placing, allowed: !denied, message: denied })
    if (!perm.allowed || perm.cancelled) {
      if (perm.message) this._throttledMessage('blockperm', perm.message)
      return this._revertBlock(x, y, z)
    }

    const ev = server.events.fire('blockChange', { player: this, level, x, y, z, oldBlock, block, placing })
    if (ev.cancelled) {
      if (ev.cancelReason) this._throttledMessage('blockcancel', ev.cancelReason)
      return this._revertBlock(x, y, z)
    }
    block = ev.block

    // stacking slabs creates a double slab, like classic servers
    if (placing && (block === 44 || block === 50) && y > 0 && level.getBlock(x, y - 1, z) === block) {
      this._revertBlock(x, y, z)
      level.setBlock(x, y - 1, z, block === 44 ? 43 : 4)
    } else if (!level.setBlock(x, y, z, block)) {
      this._revertBlock(x, y, z)
    }

    if (placing) this.record.blocksPlaced++
    else this.record.blocksDeleted++
  }

  _throttledMessage (key, msg) {
    const now = Date.now()
    this._throttle = this._throttle || {}
    if ((this._throttle[key] || 0) > now) return
    this._throttle[key] = now + 2000
    this.message(msg)
  }

  _onMessage (p) {
    this.lastActivity = Date.now()
    let msg = p.message
    if (p.partial === 1 && this.supports('LongerMessages')) {
      if (this.partialMessage.length < 2048) this.partialMessage += msg
      return
    }
    if (this.partialMessage) { msg = this.partialMessage + msg; this.partialMessage = '' }
    msg = msg.trim()
    if (!msg) return

    if (msg.startsWith('/') && !msg.startsWith('//')) {
      this.server.commands.execute(this, msg)
      return
    }
    if (msg.startsWith('//')) msg = msg.slice(1)
    this.chat(msg)
  }

  // Sends a chat message as this player (applies mute, colors and chat events)
  chat (msg) {
    const server = this.server
    const r = this.record
    if (r.muteUntil && r.muteUntil > Date.now()) {
      return this._throttledMessage('mute', `&cYou are muted for another ${text.formatDuration(r.muteUntil - Date.now())}.`)
    }
    if (this.permission >= server.ranks.permissionOf(server.config.chatColorsRank)) msg = text.convertPercentCodes(msg)
    msg = text.sanitize(msg)

    const ev = server.events.fire('playerChat', { player: this, message: msg, format: null })
    if (ev.cancelled) {
      if (ev.cancelReason) this.message(ev.cancelReason)
      return
    }
    r.messages++
    const line = ev.format || `${this.displayName}&f: ${ev.message}`
    server.log.info(`<${this.name}> ${ev.message}`)
    for (const p of server.players) if (p.loggedIn) p.message(line)
  }

  _onClick (p) {
    if (!this.spawned) return
    this.server.events.fire('playerClick', {
      player: this,
      button: ['left', 'right', 'middle'][p.button] || p.button,
      action: p.action === 0 ? 'press' : 'release',
      yaw: p.yaw,
      pitch: p.pitch,
      targetEntity: p.targetEntity,
      target: p.x === -1 && p.y === -1 && p.z === -1 ? null : { x: p.x, y: p.y, z: p.z, face: p.face }
    })
  }
}

module.exports = { Player, MESSAGE_TYPES, EYE, toUnits }
