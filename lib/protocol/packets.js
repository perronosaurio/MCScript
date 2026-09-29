'use strict'

// Classic protocol 7 + CPE (Classic Protocol Extension) packet definitions.
// Sizes match the ClassiCube client (src/Protocol.c) for the extension versions we advertise.

const cp437 = require('./cp437')

const TYPE_SIZES = { u8: 1, i8: 1, u16: 2, i16: 2, i32: 4, f32: 4, str: 64 }

// Some field types depend on the extensions negotiated with the client:
//   blk      - a block id: 1 byte, or 2 bytes with ExtendedBlocks
//   pos      - an entity coordinate: 2 bytes, or 4 bytes with ExtEntityPositions
//   xbytes:N - N extra bytes that only exist with ExtendedBlocks
function typeSize (type, opts = NO_OPTS) {
  if (type === 'blk') return opts.extBlocks ? 2 : 1
  if (type === 'pos') return opts.extPos ? 4 : 2
  if (type.startsWith('bytes:')) return Number(type.slice(6))
  if (type.startsWith('xbytes:')) return opts.extBlocks ? Number(type.slice(7)) : 0
  return TYPE_SIZES[type]
}

const NO_OPTS = { extBlocks: false, extPos: false }
const VARIANTS = [
  { extBlocks: false, extPos: false },
  { extBlocks: true, extPos: false },
  { extBlocks: false, extPos: true },
  { extBlocks: true, extPos: true }
]
const variantIndex = opts => (opts.extBlocks ? 1 : 0) + (opts.extPos ? 2 : 0)

function def (id, fields) {
  const parsed = fields.map(f => {
    const [name, type] = f.split(':')
    return [name, type === 'bytes' || type === 'xbytes' ? f.slice(name.length + 1) : type]
  })
  const sizes = VARIANTS.map(v => 1 + parsed.reduce((n, [, t]) => n + typeSize(t, v), 0))
  return { id, fields: parsed, size: sizes[0], sizes }
}

// Size of a packet for a connection with the given extension flags
function sizeOf (packet, opts = NO_OPTS) {
  return packet.sizes[variantIndex(opts)]
}

// Packets sent by the server
const SERVER = {
  serverIdentification: def(0x00, ['protocolVersion:u8', 'serverName:str', 'motd:str', 'userType:u8']),
  ping: def(0x01, []),
  levelInitialize: def(0x02, []),
  levelInitializeFast: def(0x02, ['volume:i32']),
  levelDataChunk: def(0x03, ['length:i16', 'data:bytes:1024', 'percent:u8']),
  levelFinalize: def(0x04, ['x:i16', 'y:i16', 'z:i16']),
  setBlock: def(0x06, ['x:i16', 'y:i16', 'z:i16', 'block:blk']),
  spawnPlayer: def(0x07, ['id:i8', 'entityName:str', 'x:pos', 'y:pos', 'z:pos', 'yaw:u8', 'pitch:u8']),
  teleport: def(0x08, ['id:i8', 'x:pos', 'y:pos', 'z:pos', 'yaw:u8', 'pitch:u8']),
  posAndOrientUpdate: def(0x09, ['id:i8', 'dx:i8', 'dy:i8', 'dz:i8', 'yaw:u8', 'pitch:u8']),
  posUpdate: def(0x0a, ['id:i8', 'dx:i8', 'dy:i8', 'dz:i8']),
  orientUpdate: def(0x0b, ['id:i8', 'yaw:u8', 'pitch:u8']),
  despawnPlayer: def(0x0c, ['id:i8']),
  message: def(0x0d, ['type:i8', 'message:str']),
  disconnect: def(0x0e, ['reason:str']),
  updateUserType: def(0x0f, ['userType:u8']),
  // CPE
  extInfo: def(0x10, ['appName:str', 'count:i16']),
  extEntry: def(0x11, ['extName:str', 'version:i32']),
  setClickDistance: def(0x12, ['distance:i16']),
  customBlockSupportLevel: def(0x13, ['level:u8']),
  holdThis: def(0x14, ['block:blk', 'preventChange:u8']),
  setTextHotKey: def(0x15, ['label:str', 'action:str', 'keyCode:i32', 'keyMods:u8']),
  extAddPlayerName: def(0x16, ['nameId:i16', 'playerName:str', 'listName:str', 'groupName:str', 'groupRank:u8']),
  extRemovePlayerName: def(0x18, ['nameId:i16']),
  envSetColor: def(0x19, ['variable:u8', 'r:i16', 'g:i16', 'b:i16']),
  makeSelection: def(0x1a, ['id:u8', 'label:str', 'x1:i16', 'y1:i16', 'z1:i16', 'x2:i16', 'y2:i16', 'z2:i16', 'r:i16', 'g:i16', 'b:i16', 'a:i16']),
  removeSelection: def(0x1b, ['id:u8']),
  setBlockPermission: def(0x1c, ['block:blk', 'allowPlace:u8', 'allowDelete:u8']),
  changeModel: def(0x1d, ['id:i8', 'model:str']),
  envSetWeatherType: def(0x1f, ['weather:u8']),
  hackControl: def(0x20, ['flying:u8', 'noClip:u8', 'speeding:u8', 'spawnControl:u8', 'thirdPerson:u8', 'jumpHeight:i16']),
  extAddEntity2: def(0x21, ['id:i8', 'entityName:str', 'skin:str', 'x:pos', 'y:pos', 'z:pos', 'yaw:u8', 'pitch:u8']),
  defineBlock: def(0x23, ['block:blk', 'blockName:str', 'collide:u8', 'speed:u8', 'topTex:u8', 'sideTex:u8', 'bottomTex:u8',
    'transmitsLight:u8', 'walkSound:u8', 'fullBright:u8', 'shape:u8', 'draw:u8', 'fogDensity:u8', 'fogR:u8', 'fogG:u8', 'fogB:u8']),
  removeBlockDefinition: def(0x24, ['block:blk']),
  // BlockDefinitionsExt version 2
  defineBlockExt: def(0x25, ['block:blk', 'blockName:str', 'collide:u8', 'speed:u8', 'topTex:u8', 'leftTex:u8', 'rightTex:u8',
    'frontTex:u8', 'backTex:u8', 'bottomTex:u8', 'transmitsLight:u8', 'walkSound:u8', 'fullBright:u8',
    'minX:i8', 'minY:i8', 'minZ:i8', 'maxX:i8', 'maxY:i8', 'maxZ:i8', 'draw:u8', 'fogDensity:u8', 'fogR:u8', 'fogG:u8', 'fogB:u8']),
  bulkBlockUpdate: def(0x26, ['count:u8', 'indices:bytes:1024', 'blocks:bytes:256', 'high:xbytes:64']),
  setTextColor: def(0x27, ['r:u8', 'g:u8', 'b:u8', 'a:u8', 'code:u8']),
  setMapEnvUrl: def(0x28, ['url:str']),
  setMapEnvProperty: def(0x29, ['type:u8', 'value:i32']),
  setEntityProperty: def(0x2a, ['id:i8', 'type:u8', 'value:i32']),
  twoWayPing: def(0x2b, ['direction:u8', 'data:i16']),
  setInventoryOrder: def(0x2c, ['block:blk', 'order:blk']),
  setHotbar: def(0x2d, ['block:blk', 'index:u8']),
  setSpawnpoint: def(0x2e, ['x:pos', 'y:pos', 'z:pos', 'yaw:u8', 'pitch:u8']),
  velocityControl: def(0x2f, ['x:i32', 'y:i32', 'z:i32', 'modeX:u8', 'modeY:u8', 'modeZ:u8']),
  lightingMode: def(0x37, ['mode:u8', 'locked:u8']),
  // CustomParticles
  defineEffect: def(0x30, ['effectId:u8', 'u1:u8', 'v1:u8', 'u2:u8', 'v2:u8', 'r:u8', 'g:u8', 'b:u8', 'frameCount:u8',
    'particleCount:u8', 'size:u8', 'sizeVariation:i32', 'spread:u16', 'speed:i32', 'gravity:i32', 'baseLifetime:i32',
    'lifetimeVariation:i32', 'collideFlags:u8', 'fullBright:u8']),
  spawnEffect: def(0x31, ['effectId:u8', 'x:i32', 'y:i32', 'z:i32', 'originX:i32', 'originY:i32', 'originZ:i32']),
  // CustomModels version 2 (coordinates in blocks, big endian floats)
  defineModel: def(0x32, ['modelId:u8', 'modelName:str', 'flags:u8', 'nameY:f32', 'eyeY:f32', 'collisionX:f32', 'collisionY:f32',
    'collisionZ:f32', 'pickMinX:f32', 'pickMinY:f32', 'pickMinZ:f32', 'pickMaxX:f32', 'pickMaxY:f32', 'pickMaxZ:f32',
    'uScale:u16', 'vScale:u16', 'numParts:u8']),
  defineModelPart: def(0x33, ['modelId:u8', 'minX:f32', 'minY:f32', 'minZ:f32', 'maxX:f32', 'maxY:f32', 'maxZ:f32', 'uv:bytes:48',
    'originX:f32', 'originY:f32', 'originZ:f32', 'rotX:f32', 'rotY:f32', 'rotZ:f32', 'anims:bytes:68', 'flags:u8']),
  undefineModel: def(0x34, ['modelId:u8']),
  pluginMessage: def(0x35, ['channel:u8', 'data:bytes:64']),
  cinematicGui: def(0x38, ['hideCrosshair:u8', 'hideHand:u8', 'hideHotbar:u8', 'r:u8', 'g:u8', 'b:u8', 'a:u8', 'barSize:u16']),
  toggleBlockList: def(0x3b, ['close:u8'])
}

// Packets sent by the client, indexed by id
const CLIENT = {
  0x00: { name: 'identification', ...def(0x00, ['protocolVersion:u8', 'username:str', 'key:str', 'padding:u8']) },
  0x05: { name: 'setBlock', ...def(0x05, ['x:i16', 'y:i16', 'z:i16', 'mode:u8', 'block:blk']) },
  0x08: { name: 'position', ...def(0x08, ['heldBlock:blk', 'x:pos', 'y:pos', 'z:pos', 'yaw:u8', 'pitch:u8']) },
  0x0d: { name: 'message', ...def(0x0d, ['partial:u8', 'message:str']) },
  0x10: { name: 'extInfo', ...def(0x10, ['appName:str', 'count:i16']) },
  0x11: { name: 'extEntry', ...def(0x11, ['extName:str', 'version:i32']) },
  0x13: { name: 'customBlockSupportLevel', ...def(0x13, ['level:u8']) },
  0x22: { name: 'playerClicked', ...def(0x22, ['button:u8', 'action:u8', 'yaw:i16', 'pitch:i16', 'targetEntity:i8', 'x:i16', 'y:i16', 'z:i16', 'face:u8']) },
  0x2b: { name: 'twoWayPing', ...def(0x2b, ['direction:u8', 'data:i16']) },
  0x35: { name: 'pluginMessage', ...def(0x35, ['channel:u8', 'data:bytes:64']) },
  0x39: { name: 'notifyAction', ...def(0x39, ['action:u16', 'value:u16']) },
  0x3a: { name: 'notifyPositionAction', ...def(0x3a, ['action:u16', 'x:i16', 'y:i16', 'z:i16']) }
}

// Extensions this server implements, with the version we speak
const EXTENSIONS = {
  ClickDistance: 1,
  CustomBlocks: 1,
  HeldBlock: 1,
  EmoteFix: 1,
  TextHotKey: 1,
  ExtPlayerList: 2,
  EnvColors: 1,
  SelectionCuboid: 1,
  BlockPermissions: 1,
  ChangeModel: 1,
  EnvWeatherType: 1,
  HackControl: 1,
  MessageTypes: 1,
  PlayerClick: 1,
  FullCP437: 1,
  LongerMessages: 1,
  BlockDefinitions: 1,
  BlockDefinitionsExt: 2,
  BulkBlockUpdate: 1,
  TextColors: 1,
  EnvMapAspect: 1,
  EntityProperty: 1,
  TwoWayPing: 1,
  InventoryOrder: 1,
  InstantMOTD: 1,
  FastMap: 1,
  SetHotbar: 1,
  SetSpawnpoint: 1,
  VelocityControl: 1,
  LightingMode: 1,
  ExtendedBlocks: 1,
  ExtEntityPositions: 1,
  CustomParticles: 1,
  CustomModels: 2,
  PluginMessages: 1,
  CinematicGui: 1,
  NotifyAction: 1,
  ToggleBlockList: 1
}

function writeString (buf, offset, value, fullCP437) {
  const bytes = cp437.encode(value == null ? '' : value, fullCP437)
  for (let i = 0; i < 64; i++) buf[offset + i] = i < bytes.length ? bytes[i] : 0x20
}

function readString (buf, offset) {
  let end = offset + 64
  while (end > offset && (buf[end - 1] === 0x20 || buf[end - 1] === 0x00)) end--
  return cp437.decode(buf.subarray(offset, end))
}

function encode (name, data = {}, opts = {}) {
  const packet = SERVER[name]
  if (!packet) throw new Error(`Unknown packet ${name}`)
  const buf = Buffer.alloc(sizeOf(packet, opts))
  buf[0] = packet.id
  let o = 1
  for (const [field, rawType] of packet.fields) {
    const v = data[field]
    let type = rawType
    if (type === 'blk') type = opts.extBlocks ? 'u16' : 'u8'
    else if (type === 'pos') type = opts.extPos ? 'i32' : 'i16'
    switch (type) {
      case 'u8': buf.writeUInt8((v | 0) & 0xFF, o); o += 1; break
      case 'i8': buf.writeInt8(clamp(v | 0, -128, 127), o); o += 1; break
      case 'u16': buf.writeUInt16BE((v | 0) & 0xFFFF, o); o += 2; break
      case 'i16': buf.writeInt16BE(clamp(v | 0, -32768, 32767), o); o += 2; break
      case 'i32': buf.writeInt32BE(v | 0, o); o += 4; break
      case 'f32': buf.writeFloatBE(Number(v) || 0, o); o += 4; break
      case 'str': writeString(buf, o, v, opts.fullCP437 !== false); o += 64; break
      default: {
        const n = typeSize(type, opts)
        if (v && n) Buffer.from(v).copy(buf, o, 0, Math.min(n, v.length))
        o += n
      }
    }
  }
  return buf
}

function decode (id, buf, opts = NO_OPTS) {
  const packet = CLIENT[id]
  const out = { name: packet.name }
  let o = 1
  for (const [field, rawType] of packet.fields) {
    let type = rawType
    if (type === 'blk') type = opts.extBlocks ? 'u16' : 'u8'
    else if (type === 'pos') type = opts.extPos ? 'i32' : 'i16'
    switch (type) {
      case 'u8': out[field] = buf.readUInt8(o); o += 1; break
      case 'i8': out[field] = buf.readInt8(o); o += 1; break
      case 'u16': out[field] = buf.readUInt16BE(o); o += 2; break
      case 'i16': out[field] = buf.readInt16BE(o); o += 2; break
      case 'i32': out[field] = buf.readInt32BE(o); o += 4; break
      case 'f32': out[field] = buf.readFloatBE(o); o += 4; break
      case 'str': out[field] = readString(buf, o); o += 64; break
      default: {
        const n = typeSize(type, opts)
        out[field] = Buffer.from(buf.subarray(o, o + n)); o += n
      }
    }
  }
  return out
}

function clamp (v, min, max) { return v < min ? min : v > max ? max : v }

module.exports = { SERVER, CLIENT, EXTENSIONS, encode, decode, sizeOf, readString, writeString }
