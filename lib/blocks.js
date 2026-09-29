'use strict'

// Block ids, names, CPE fallbacks and custom block definitions (BlockDefinitions CPE extension).

const NAMES = [
  'Air', 'Stone', 'Grass', 'Dirt', 'Cobblestone', 'Wood', 'Sapling', 'Bedrock', 'Water', 'Still water',
  'Lava', 'Still lava', 'Sand', 'Gravel', 'Gold ore', 'Iron ore', 'Coal ore', 'Log', 'Leaves', 'Sponge',
  'Glass', 'Red', 'Orange', 'Yellow', 'Lime', 'Green', 'Teal', 'Aqua', 'Cyan', 'Blue',
  'Indigo', 'Violet', 'Magenta', 'Pink', 'Black', 'Gray', 'White', 'Dandelion', 'Rose', 'Brown mushroom',
  'Red mushroom', 'Gold', 'Iron', 'Double slab', 'Slab', 'Brick', 'TNT', 'Bookshelf', 'Mossy rocks', 'Obsidian',
  // CustomBlocks (CPE)
  'Cobblestone slab', 'Rope', 'Sandstone', 'Snow', 'Fire', 'Light pink', 'Forest green', 'Brown', 'Deep blue', 'Turquoise',
  'Ice', 'Ceramic tile', 'Magma', 'Pillar', 'Crate', 'Stone brick'
]

const MAX_CLASSIC = 49
const MAX_CPE = 65
const MAX_BLOCK = 767 // 0x2FF, the highest id with ExtendedBlocks

// CustomBlocks -> classic replacement for clients without the extension
const CPE_FALLBACK = {
  50: 44, 51: 39, 52: 12, 53: 0, 54: 10, 55: 33, 56: 25, 57: 3, 58: 29, 59: 28, 60: 20, 61: 42, 62: 49, 63: 36, 64: 5, 65: 1
}

// Default textures [top, side, bottom] in the terrain atlas, used when copying a core block
const TEXTURES = {
  1: [1, 1, 1],
  2: [0, 3, 2],
  3: [2, 2, 2],
  4: [16, 16, 16],
  5: [4, 4, 4],
  6: [15, 15, 15],
  7: [17, 17, 17],
  8: [14, 14, 14],
  9: [14, 14, 14],
  10: [30, 30, 30],
  11: [30, 30, 30],
  12: [18, 18, 18],
  13: [19, 19, 19],
  14: [32, 32, 32],
  15: [33, 33, 33],
  16: [34, 34, 34],
  17: [21, 20, 21],
  18: [22, 22, 22],
  19: [48, 48, 48],
  20: [49, 49, 49],
  37: [13, 13, 13],
  38: [12, 12, 12],
  39: [29, 29, 29],
  40: [28, 28, 28],
  41: [24, 40, 56],
  42: [23, 39, 55],
  43: [6, 5, 6],
  44: [6, 5, 6],
  45: [7, 7, 7],
  46: [9, 8, 10],
  47: [4, 35, 4],
  48: [36, 36, 36],
  49: [37, 37, 37],
  50: [16, 16, 16],
  51: [11, 11, 11],
  52: [25, 41, 57],
  53: [50, 50, 50],
  54: [38, 38, 38],
  55: [80, 80, 80],
  56: [81, 81, 81],
  57: [82, 82, 82],
  58: [83, 83, 83],
  59: [84, 84, 84],
  60: [51, 51, 51],
  61: [54, 54, 54],
  62: [86, 86, 86],
  63: [26, 42, 58],
  64: [53, 53, 53],
  65: [52, 52, 52]
}
for (let id = 21; id <= 36; id++) TEXTURES[id] = [id + 43, id + 43, id + 43]

const COLLIDE = { walkthrough: 0, swim: 1, solid: 2, ice: 3, slipperyice: 4, water: 5, lava: 6, climb: 7, rope: 7 }
const DRAW = { opaque: 0, transparent: 1, transparentinside: 2, translucent: 3, gas: 4 }
const SOUNDS = { none: 0, wood: 1, gravel: 2, grass: 3, stone: 4, metal: 5, glass: 6, cloth: 7, sand: 8, snow: 9 }

function coreDefinition (id) {
  const tex = TEXTURES[id] || [1, 1, 1]
  const def = {
    id,
    name: NAMES[id] || `Block ${id}`,
    collide: COLLIDE.solid,
    speed: 1,
    textures: { top: tex[0], bottom: tex[2], left: tex[1], right: tex[1], front: tex[1], back: tex[1] },
    transmitsLight: false,
    sound: SOUNDS.stone,
    fullBright: false,
    draw: DRAW.opaque,
    sprite: false,
    min: [0, 0, 0],
    max: [16, 16, 16],
    fogDensity: 0,
    fogColor: [0, 0, 0],
    fallback: id <= MAX_CPE ? (CPE_FALLBACK[id] ?? id) : 1
  }
  if ([6, 37, 38, 39, 40, 51, 54].includes(id)) { def.sprite = true; def.collide = COLLIDE.walkthrough; def.draw = DRAW.transparent; def.transmitsLight = true; def.sound = SOUNDS.grass }
  if ([8, 9].includes(id)) { def.collide = COLLIDE.water; def.draw = DRAW.translucent; def.max[1] = 16; def.fogDensity = 11; def.fogColor = [5, 5, 51] }
  if ([10, 11].includes(id)) { def.collide = COLLIDE.lava; def.fullBright = true; def.fogDensity = 229; def.fogColor = [153, 25, 0] }
  if ([18].includes(id)) { def.draw = DRAW.transparentinside; def.sound = SOUNDS.grass }
  if ([20].includes(id)) { def.draw = DRAW.transparent; def.sound = SOUNDS.glass }
  if ([44, 50].includes(id)) def.max = [16, 8, 16]
  if (id === 53) { def.max = [16, 2, 16]; def.collide = COLLIDE.walkthrough; def.sound = SOUNDS.snow }
  if (id === 60) { def.draw = DRAW.translucent; def.collide = COLLIDE.ice; def.sound = SOUNDS.glass }
  if (id === 51) def.collide = COLLIDE.climb
  if (id >= 21 && id <= 36) def.sound = SOUNDS.cloth
  if ([2, 18].includes(id)) def.sound = SOUNDS.grass
  if ([12, 13].includes(id)) def.sound = SOUNDS.sand
  if ([5, 17, 47, 64].includes(id)) def.sound = SOUNDS.wood
  if ([41, 42].includes(id)) def.sound = SOUNDS.metal
  if (id === 62) def.fullBright = true
  return def
}

// Fill in any missing fields of a (possibly user edited) definition
function normalize (def) {
  const base = coreDefinition(1)
  const out = { ...base, ...def }
  out.textures = { ...base.textures, ...(def.textures || {}) }
  out.min = (def.min || base.min).map(v => clampInt(v, 0, 16))
  out.max = (def.max || base.max).map(v => clampInt(v, 0, 16))
  out.fogColor = (def.fogColor || base.fogColor).map(v => clampInt(v, 0, 255))
  out.id = clampInt(def.id, 1, MAX_BLOCK)
  out.fallback = clampInt(def.fallback ?? 1, 0, MAX_CPE)
  return out
}

function speedToByte (speed) {
  const v = Math.round(128 + 64 * Math.log2(Math.max(0.25, Math.min(3.96, speed || 1))))
  return clampInt(v, 0, 255)
}

function fogToByte (density) {
  return clampInt(density, 0, 255)
}

// Build the packet (name + data) used to send a definition to a client
function definitionPacket (def, useExt) {
  def = normalize(def)
  const common = {
    block: def.id,
    blockName: def.name,
    collide: def.collide,
    speed: speedToByte(def.speed),
    topTex: def.textures.top,
    bottomTex: def.textures.bottom,
    transmitsLight: def.transmitsLight ? 1 : 0,
    walkSound: def.sound,
    fullBright: def.fullBright ? 1 : 0,
    draw: def.draw,
    fogDensity: fogToByte(def.fogDensity),
    fogR: def.fogColor[0],
    fogG: def.fogColor[1],
    fogB: def.fogColor[2]
  }
  if (def.sprite || !useExt) {
    return ['defineBlock', {
      ...common,
      sideTex: def.textures.left,
      shape: def.sprite ? 0 : Math.max(1, def.max[1]),
      // for sprites the draw field is the sprite offset
      draw: def.sprite ? 0 : def.draw
    }]
  }
  return ['defineBlockExt', {
    ...common,
    leftTex: def.textures.left,
    rightTex: def.textures.right,
    frontTex: def.textures.front,
    backTex: def.textures.back,
    minX: def.min[0],
    minY: def.min[1],
    minZ: def.min[2],
    maxX: def.max[0],
    maxY: def.max[1],
    maxZ: def.max[2]
  }]
}

function clampInt (v, min, max) {
  v = Math.round(Number(v) || 0)
  return v < min ? min : v > max ? max : v
}

const nameIndex = new Map(NAMES.map((n, i) => [n.toLowerCase().replace(/[\s_-]/g, ''), i]))
// common aliases
Object.entries({
  planks: 5,
  wood: 5,
  activewater: 8,
  stillwater: 9,
  activelava: 10,
  stilllava: 11,
  wool: 36,
  log: 17,
  trunk: 17,
  slab: 44,
  stair: 44,
  stairs: 44,
  doublestair: 43,
  mossy: 48,
  mossycobblestone: 48,
  cobble: 4,
  brickblock: 45,
  yellowflower: 37,
  redflower: 38,
  flower: 37,
  shroom: 39,
  goldblock: 41,
  ironblock: 42
}).forEach(([k, v]) => { if (!nameIndex.has(k)) nameIndex.set(k, v) })

function coreName (id) {
  return NAMES[id] || null
}

// Parse a block by name or id. `customDefs` is a lookup function id -> def (level + global).
function parse (input, customDefs) {
  if (input === undefined || input === null || input === '') return null
  const str = String(input).toLowerCase().replace(/[\s_-]/g, '')
  if (/^\d+$/.test(str)) {
    const id = Number(str)
    if (id > MAX_BLOCK) return null
    if (id <= MAX_CPE) return id
    return customDefs && customDefs(id) ? id : null
  }
  if (customDefs) {
    for (let id = 1; id <= MAX_BLOCK; id++) {
      const def = customDefs(id)
      if (def && def.name.toLowerCase().replace(/[\s_-]/g, '') === str) return id
    }
  }
  return nameIndex.has(str) ? nameIndex.get(str) : null
}

module.exports = {
  NAMES,
  MAX_CLASSIC,
  MAX_CPE,
  MAX_BLOCK,
  CPE_FALLBACK,
  COLLIDE,
  DRAW,
  SOUNDS,
  coreDefinition,
  coreName,
  normalize,
  definitionPacket,
  speedToByte,
  parse
}
