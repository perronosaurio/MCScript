'use strict'

const zlib = require('zlib')
const crypto = require('crypto')
const nbt = require('../util/nbt')
const Blocks = require('../blocks')

const { t } = nbt

const MAX_DIM = 8192

const ENV_COLORS = ['skyColor', 'cloudColor', 'fogColor', 'shadowColor', 'sunColor', 'skyboxColor']
// ids for SetMapEnvProperty
const ENV_PROPS = {
  sideBlock: 0,
  edgeBlock: 1,
  edgeHeight: 2,
  cloudsHeight: 3,
  maxFog: 4,
  cloudsSpeed: 5,
  weatherSpeed: 6,
  weatherFade: 7,
  expFog: 8,
  sidesOffset: 9,
  skyboxHorSpeed: 10,
  skyboxVerSpeed: 11
}

function defaultEnv () {
  return {
    texture: '',
    skyColor: null,
    cloudColor: null,
    fogColor: null,
    shadowColor: null,
    sunColor: null,
    skyboxColor: null,
    weather: 0,
    sideBlock: 7,
    edgeBlock: 8,
    edgeHeight: null,
    cloudsHeight: null,
    maxFog: 0,
    cloudsSpeed: 1,
    weatherSpeed: 1,
    weatherFade: 1,
    expFog: false,
    sidesOffset: -2,
    skyboxHorSpeed: 0,
    skyboxVerSpeed: 0,
    lighting: null
  }
}

class Level {
  constructor ({ name, width, height, length }) {
    if (!(width >= 1 && height >= 1 && length >= 1 && width <= MAX_DIM && height <= MAX_DIM && length <= MAX_DIM)) {
      throw new Error(`Level dimensions must be between 1 and ${MAX_DIM}`)
    }
    this.name = name
    this.width = width
    this.height = height
    this.length = length
    this.blocks = new Uint8Array(width * height * length)
    this.upper = null // high byte of block ids above 255 (ExtendedBlocks), created on demand
    this.spawn = { x: width / 2, y: height / 2 + 2, z: length / 2, yaw: 0, pitch: 0 }
    this.env = defaultEnv()
    this.motd = 'ignore' // 'ignore' = use server motd; can hold hack flags like "-hax +fly"
    this.buildRank = null // null = default rank can build
    this.owners = [] // lowercase names that can always build here (personal maps)
    this.visitRank = null
    this.blockDefs = {} // level specific custom blocks: id -> definition
    this.meta = {} // free storage for plugins (saved with the level)
    this.uuid = crypto.randomBytes(16)
    this.createdBy = null
    this.generator = null
    this.createdAt = Date.now()
    this.dirty = false
    this.server = null
  }

  get volume () { return this.width * this.height * this.length }

  index (x, y, z) { return (y * this.length + z) * this.width + x }

  unpack (index) {
    const x = index % this.width
    const z = Math.floor(index / this.width) % this.length
    const y = Math.floor(index / (this.width * this.length))
    return { x, y, z }
  }

  inBounds (x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.width && y < this.height && z < this.length
  }

  // Levels too big for clients without ExtEntityPositions (coordinates would overflow)
  get needsExtPositions () { return Math.max(this.width, this.height, this.length) > 1023 }

  getBlock (x, y, z) {
    if (!this.inBounds(x, y, z)) return 0
    return this.getAt(this.index(x, y, z))
  }

  // Block at a raw index
  getAt (i) {
    return this.upper ? this.blocks[i] | (this.upper[i] << 8) : this.blocks[i]
  }

  setAt (i, block) {
    this.blocks[i] = block & 0xFF
    if (block > 0xFF) {
      if (!this.upper) this.upper = new Uint8Array(this.blocks.length)
      this.upper[i] = block >> 8
    } else if (this.upper) {
      this.upper[i] = 0
    }
  }

  setBlockRaw (x, y, z, block) {
    this.setAt(this.index(x, y, z), block)
  }

  // Sets a block and broadcasts the change to players in this level
  setBlock (x, y, z, block) {
    if (!this.inBounds(x, y, z)) return false
    const i = this.index(x, y, z)
    if (this.getAt(i) === block) return false
    this.setAt(i, block)
    this.dirty = true
    if (this.server) this.server.broadcastBlockChanges(this, [[i, block]])
    return true
  }

  // Sets many blocks at once: changes = [[x, y, z, block], ...]. Uses BulkBlockUpdate when possible.
  setBlocks (changes) {
    const applied = []
    for (const [x, y, z, block] of changes) {
      if (!this.inBounds(x, y, z)) continue
      const i = this.index(x, y, z)
      if (this.getAt(i) === block) continue
      this.setAt(i, block)
      applied.push([i, block])
    }
    if (applied.length) {
      this.dirty = true
      if (this.server) this.server.broadcastBlockChanges(this, applied)
    }
    return applied.length
  }

  // First y above the highest non-air block in a column (useful for spawn points)
  highestFreeY (x, z) {
    for (let y = this.height - 1; y >= 0; y--) {
      if (this.getBlock(x, y, z) !== 0) return y + 1
    }
    return 1
  }

  isOwner (player) {
    return !!player.name && this.owners.includes(player.name.toLowerCase())
  }

  // Build rank or ownership
  canBuild (player) {
    if (player.isConsole || this.isOwner(player)) return true
    const ranks = this.server && this.server.ranks
    return !ranks || player.permission >= ranks.permissionOf(this.buildRank)
  }

  getBlockDef (id) {
    if (this.blockDefs[id]) return this.blockDefs[id]
    if (this.server) return this.server.blockDefs[id] || null
    return null
  }

  blockName (id) {
    const def = this.getBlockDef(id)
    if (def) return def.name
    return Blocks.coreName(id) || `Unknown (${id})`
  }

  parseBlock (input) {
    return Blocks.parse(input, id => this.getBlockDef(id))
  }

  isValidBlock (id) {
    return id <= Blocks.MAX_CPE || !!this.getBlockDef(id)
  }

  get players () {
    return this.server ? this.server.players.filter(p => p.level === this) : []
  }

  // Blocks for the map transfer, translated for one client: each array is prefixed with the
  // 4 byte big endian volume (classic format). `upper` is only returned when a block id > 255 is sent.
  serializeForClient (translate) {
    const volume = this.volume
    const lower = Buffer.alloc(4 + volume)
    lower.writeInt32BE(volume, 0)
    let upper = null
    const up = this.upper
    for (let i = 0; i < volume; i++) {
      const b = translate[up ? this.blocks[i] | (up[i] << 8) : this.blocks[i]]
      lower[4 + i] = b & 0xFF
      if (b > 0xFF) {
        if (!upper) { upper = Buffer.alloc(4 + volume); upper.writeInt32BE(volume, 0) }
        upper[4 + i] = b >> 8
      }
    }
    return { lower, upper }
  }

  resolvedEnv () {
    const env = { ...this.env }
    if (env.edgeHeight === null) env.edgeHeight = Math.floor(this.height / 2)
    if (env.cloudsHeight === null) env.cloudsHeight = this.height + 2
    return env
  }

  // ---------------------------------------------------------------- ClassicWorld (.cw)

  toCW () {
    const env = this.env
    const colorTag = hex => {
      if (!hex) return { R: t.short(-1), G: t.short(-1), B: t.short(-1) }
      const n = parseInt(hex, 16)
      return { R: t.short((n >> 16) & 255), G: t.short((n >> 8) & 255), B: t.short(n & 255) }
    }
    const blockDefs = {}
    for (const def of Object.values(this.blockDefs)) {
      const d = Blocks.normalize(def)
      blockDefs['Block' + d.id] = t.compound({
        ID: t.byte((d.id & 0xFF) << 24 >> 24),
        ID2: t.short(d.id),
        Name: t.string(d.name),
        Speed: t.float(d.speed),
        CollideType: t.byte(d.collide),
        Textures: t.bytes(Buffer.from([d.textures.top, d.textures.bottom, d.textures.left, d.textures.right, d.textures.front, d.textures.back])),
        TransmitsLight: t.byte(d.transmitsLight ? 1 : 0),
        WalkSound: t.byte(d.sound),
        FullBright: t.byte(d.fullBright ? 1 : 0),
        Shape: t.byte(d.sprite ? 0 : d.max[1]),
        BlockDraw: t.byte(d.draw),
        Fog: t.bytes(Buffer.from([d.fogDensity, ...d.fogColor])),
        Coords: t.bytes(Buffer.from([...d.min, ...d.max]))
      })
    }

    const mcscript = {
      env: this.env,
      motd: this.motd,
      buildRank: this.buildRank,
      owners: this.owners,
      visitRank: this.visitRank,
      blockDefs: this.blockDefs,
      meta: this.meta
    }

    const root = {
      FormatVersion: t.byte(1),
      Name: t.string(this.name),
      UUID: t.bytes(this.uuid),
      X: t.short(this.width),
      Y: t.short(this.height),
      Z: t.short(this.length),
      Spawn: t.compound({
        X: t.short(Math.floor(this.spawn.x)),
        Y: t.short(Math.floor(this.spawn.y)),
        Z: t.short(Math.floor(this.spawn.z)),
        H: t.byte(this.spawn.yaw << 24 >> 24),
        P: t.byte(this.spawn.pitch << 24 >> 24)
      }),
      BlockArray: t.bytes(Buffer.from(this.blocks.buffer, this.blocks.byteOffset, this.blocks.length)),
      BlockArray2: this.upper && this.upper.some(v => v) ? t.bytes(Buffer.from(this.upper.buffer, this.upper.byteOffset, this.upper.length)) : null,
      TimeCreated: t.long(Math.floor(this.createdAt / 1000)),
      CreatedBy: t.compound({ Service: t.string('MCScript'), Username: t.string(this.createdBy || '') }),
      MapGenerator: t.compound({ Software: t.string('MCScript'), MapGeneratorName: t.string(this.generator || '') }),
      Metadata: t.compound({
        CPE: t.compound({
          EnvMapAppearance: t.compound({
            ExtensionVersion: t.int(1),
            TextureURL: t.string(env.texture || ''),
            SideBlock: t.byte(env.sideBlock << 24 >> 24),
            EdgeBlock: t.byte(env.edgeBlock << 24 >> 24),
            SideLevel: t.short(env.edgeHeight === null ? -1 : env.edgeHeight)
          }),
          EnvColors: t.compound({
            ExtensionVersion: t.int(1),
            Sky: t.compound(colorTag(env.skyColor)),
            Cloud: t.compound(colorTag(env.cloudColor)),
            Fog: t.compound(colorTag(env.fogColor)),
            Ambient: t.compound(colorTag(env.shadowColor)),
            Sunlight: t.compound(colorTag(env.sunColor))
          }),
          EnvWeatherType: t.compound({ ExtensionVersion: t.int(1), WeatherType: t.byte(env.weather) }),
          BlockDefinitions: t.compound({ ExtensionVersion: t.int(1), ...blockDefs })
        }),
        MCScript: t.compound({ Data: t.string(JSON.stringify(mcscript)) })
      })
    }
    return zlib.gzipSync(nbt.write('ClassicWorld', root))
  }

  static fromCW (buf, name) {
    const { value: root } = nbt.read(zlib.gunzipSync(buf))
    const get = (c, k) => c && c[k] ? c[k].value : undefined
    const width = get(root, 'X'); const height = get(root, 'Y'); const length = get(root, 'Z')
    const level = new Level({ name: name || get(root, 'Name') || 'level', width, height, length })
    const blocks = get(root, 'BlockArray')
    if (!blocks || blocks.length !== level.volume) throw new Error('Invalid BlockArray in .cw file')
    level.blocks.set(blocks)
    const upper = get(root, 'BlockArray2')
    if (upper && upper.length === level.volume) level.upper = new Uint8Array(upper)
    if (get(root, 'UUID')) level.uuid = get(root, 'UUID')
    const spawn = get(root, 'Spawn')
    if (spawn) {
      level.spawn = {
        x: get(spawn, 'X') + 0.5,
        y: get(spawn, 'Y'),
        z: get(spawn, 'Z') + 0.5,
        yaw: (get(spawn, 'H') || 0) & 255,
        pitch: (get(spawn, 'P') || 0) & 255
      }
    }
    const created = get(root, 'TimeCreated')
    if (created !== undefined) level.createdAt = Number(created) * 1000
    const createdBy = get(root, 'CreatedBy')
    if (createdBy) level.createdBy = get(createdBy, 'Username') || null
    const gen = get(root, 'MapGenerator')
    if (gen) level.generator = get(gen, 'MapGeneratorName') || null

    const metadata = get(root, 'Metadata') || {}
    const own = get(metadata, 'MCScript')
    if (own && get(own, 'Data')) {
      const data = JSON.parse(get(own, 'Data'))
      level.env = { ...defaultEnv(), ...(data.env || {}) }
      level.motd = data.motd ?? 'ignore'
      level.buildRank = data.buildRank ?? null
      level.owners = data.owners || []
      level.visitRank = data.visitRank ?? null
      level.blockDefs = data.blockDefs || {}
      level.meta = data.meta || {}
    } else {
      level._importCPEMetadata(get(metadata, 'CPE') || {})
    }
    return level
  }

  // Read environment/blocks written by ClassiCube or other server software
  _importCPEMetadata (cpe) {
    const get = (c, k) => c && c[k] ? c[k].value : undefined
    const app = get(cpe, 'EnvMapAppearance')
    if (app) {
      this.env.texture = get(app, 'TextureURL') || ''
      if (get(app, 'SideBlock') !== undefined) this.env.sideBlock = get(app, 'SideBlock') & 255
      if (get(app, 'EdgeBlock') !== undefined) this.env.edgeBlock = get(app, 'EdgeBlock') & 255
      const side = get(app, 'SideLevel')
      if (side !== undefined && side >= 0) this.env.edgeHeight = side
    }
    const colors = get(cpe, 'EnvColors')
    if (colors) {
      const read = c => {
        if (!c) return null
        const r = get(c, 'R'); const g = get(c, 'G'); const b = get(c, 'B')
        if (r < 0 || g < 0 || b < 0 || r > 255 || g > 255 || b > 255) return null
        return [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
      }
      this.env.skyColor = read(get(colors, 'Sky'))
      this.env.cloudColor = read(get(colors, 'Cloud'))
      this.env.fogColor = read(get(colors, 'Fog'))
      this.env.shadowColor = read(get(colors, 'Ambient'))
      this.env.sunColor = read(get(colors, 'Sunlight'))
    }
    const weather = get(cpe, 'EnvWeatherType')
    if (weather) this.env.weather = get(weather, 'WeatherType') || 0
    const defs = get(cpe, 'BlockDefinitions')
    if (defs) {
      for (const [key, tag] of Object.entries(defs)) {
        if (!key.startsWith('Block') || tag.type !== 'compound') continue
        const c = tag.value
        const id = get(c, 'ID2') !== undefined ? get(c, 'ID2') : get(c, 'ID') & 255
        if (id < 1 || id > Blocks.MAX_BLOCK) continue
        const tex = get(c, 'Textures') || Buffer.from([1, 1, 1, 1, 1, 1])
        const fog = get(c, 'Fog') || Buffer.alloc(4)
        const coords = get(c, 'Coords') || Buffer.from([0, 0, 0, 16, 16, 16])
        const shape = get(c, 'Shape') ?? 16
        this.blockDefs[id] = Blocks.normalize({
          id,
          name: get(c, 'Name') || `Block ${id}`,
          speed: get(c, 'Speed') || 1,
          collide: get(c, 'CollideType') ?? 2,
          textures: { top: tex[0], bottom: tex[1], left: tex[2], right: tex[3], front: tex[4], back: tex[5] },
          transmitsLight: !!get(c, 'TransmitsLight'),
          sound: get(c, 'WalkSound') || 0,
          fullBright: !!get(c, 'FullBright'),
          sprite: shape === 0,
          draw: get(c, 'BlockDraw') || 0,
          fogDensity: fog[0],
          fogColor: [fog[1], fog[2], fog[3]],
          min: [coords[0], coords[1], coords[2]],
          max: [coords[3], coords[4], coords[5]]
        })
      }
    }
  }

  // ---------------------------------------------------------------- imports

  // MCGalaxy / MCForge .lvl
  static fromLvl (buf, name) {
    const data = zlib.gunzipSync(buf)
    if (data.readUInt16LE(0) !== 1874) throw new Error('Not a .lvl file')
    const width = data.readUInt16LE(2); const length = data.readUInt16LE(4); const height = data.readUInt16LE(6)
    const level = new Level({ name, width, height, length })
    level.spawn = {
      x: data.readUInt16LE(8) + 0.5,
      z: data.readUInt16LE(10) + 0.5,
      y: data.readUInt16LE(12),
      yaw: data[14],
      pitch: data[15]
    }
    const volume = level.volume
    const raw = data.subarray(18, 18 + volume)
    let unknown = 0
    for (let i = 0; i < volume; i++) {
      let b = raw[i]
      // 163 = "custom block" marker in MCGalaxy; physics/op blocks (>= 66) are converted to stone
      if (b > Blocks.MAX_CPE) { b = 1; unknown++ }
      level.blocks[i] = b
    }
    level.generator = 'import:lvl'
    level.importWarnings = unknown ? [`${unknown} MCGalaxy special/custom blocks converted to stone`] : []
    return level
  }

  // Legacy MCScript level.dat (gzip: 4 byte volume + raw 256x64x256 blocks)
  static fromLegacyDat (buf, name, dims = { width: 256, height: 64, length: 256 }) {
    const data = zlib.gunzipSync(buf)
    const volume = data.readInt32BE(0)
    if (volume !== dims.width * dims.height * dims.length) throw new Error('Unexpected legacy level size')
    const level = new Level({ name, ...dims })
    level.blocks.set(data.subarray(4, 4 + volume))
    const cx = Math.floor(dims.width / 2); const cz = Math.floor(dims.length / 2)
    level.spawn = { x: cx + 0.5, y: level.highestFreeY(cx, cz), z: cz + 0.5, yaw: 0, pitch: 0 }
    level.generator = 'import:legacy'
    return level
  }
}

module.exports = { Level, ENV_COLORS, ENV_PROPS, defaultEnv, MAX_DIM }
