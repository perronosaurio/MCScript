'use strict'

// World generators. Each generator fills level.blocks and may set the spawn point.

function mulberry32 (seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 2D value noise with smooth interpolation and octaves
function makeNoise (rand) {
  const SIZE = 256
  const perm = new Uint8Array(SIZE * 2)
  const values = new Float32Array(SIZE)
  for (let i = 0; i < SIZE; i++) { perm[i] = i; values[i] = rand() * 2 - 1 }
  for (let i = SIZE - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp
  }
  for (let i = 0; i < SIZE; i++) perm[i + SIZE] = perm[i]

  const lattice = (x, z) => values[perm[(perm[x & 255] + z) & 255]]
  const smooth = t => t * t * (3 - 2 * t)

  function noise (x, z) {
    const x0 = Math.floor(x); const z0 = Math.floor(z)
    const fx = smooth(x - x0); const fz = smooth(z - z0)
    const a = lattice(x0, z0); const b = lattice(x0 + 1, z0)
    const c = lattice(x0, z0 + 1); const d = lattice(x0 + 1, z0 + 1)
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz
  }

  return function octaves (x, z, count = 4, persistence = 0.5) {
    let total = 0; let amp = 1; let freq = 1; let max = 0
    for (let i = 0; i < count; i++) {
      total += noise(x * freq, z * freq) * amp
      max += amp
      amp *= persistence
      freq *= 2
    }
    return total / max
  }
}

function fillLayer (level, y, block) {
  const { width, length } = level
  const start = y * width * length
  level.blocks.fill(block, start, start + width * length)
}

const generators = {
  empty: {
    description: 'Empty world with a bedrock floor',
    generate (level) {
      fillLayer(level, 0, 7)
      level.spawn = { x: level.width / 2, y: 2, z: level.length / 2, yaw: 0, pitch: 0 }
    }
  },

  flat: {
    description: 'Flat grass world (half the height is ground)',
    generate (level) {
      const ground = Math.floor(level.height / 2)
      for (let y = 0; y < ground; y++) {
        let block = 1
        if (y === 0) block = 7
        else if (y === ground - 1) block = 2
        else if (y >= ground - 4) block = 3
        fillLayer(level, y, block)
      }
      level.spawn = { x: level.width / 2, y: ground + 1, z: level.length / 2, yaw: 0, pitch: 0 }
    }
  },

  pixel: {
    description: 'White walls for pixel art, bedrock floor',
    generate (level) {
      const { width, height, length } = level
      fillLayer(level, 0, 7)
      for (let y = 1; y < height; y++) {
        for (let x = 0; x < width; x++) {
          level.setBlockRaw(x, y, 0, 36); level.setBlockRaw(x, y, length - 1, 36)
        }
        for (let z = 0; z < length; z++) {
          level.setBlockRaw(0, y, z, 36); level.setBlockRaw(width - 1, y, z, 36)
        }
      }
      level.spawn = { x: width / 2, y: 2, z: length / 2, yaw: 0, pitch: 0 }
    }
  },

  space: {
    description: 'Obsidian floor and walls, black sky',
    generate (level) {
      generators.pixel.generate(level)
      const { width, height, length } = level
      for (let y = 1; y < height; y++) {
        for (let x = 0; x < width; x++) { level.setBlockRaw(x, y, 0, 49); level.setBlockRaw(x, y, length - 1, 49) }
        for (let z = 0; z < length; z++) { level.setBlockRaw(0, y, z, 49); level.setBlockRaw(width - 1, y, z, 49) }
      }
      fillLayer(level, 0, 49)
      level.env.skyColor = '000000'
      level.env.fogColor = '000000'
      level.env.cloudColor = '000000'
      level.env.cloudsHeight = -16
    }
  },

  ocean: {
    description: 'Endless water with a small sand island',
    generate (level, opts) {
      const water = Math.floor(level.height / 2)
      fillLayer(level, 0, 7)
      for (let y = 1; y < water; y++) fillLayer(level, y, y < water - 6 ? 12 : 9)
      generators.island.island(level, opts, water, 12)
    }
  },

  island: {
    description: 'Terrain island surrounded by water, with trees',
    generate (level, opts) {
      generators.terrain.generate(level, { ...opts, island: true })
    },
    island (level, opts, water, block) {
      const cx = level.width / 2; const cz = level.length / 2
      const r = Math.min(level.width, level.length) / 8
      for (let x = 0; x < level.width; x++) {
        for (let z = 0; z < level.length; z++) {
          const d = Math.hypot(x - cx, z - cz)
          if (d > r) continue
          const top = water + Math.floor((1 - d / r) * 4)
          for (let y = 1; y <= top; y++) level.setBlockRaw(x, y, z, block)
        }
      }
      level.spawn = { x: cx, y: water + 6, z: cz, yaw: 0, pitch: 0 }
    }
  },

  terrain: {
    description: 'Natural rolling hills with water, beaches and trees (seeded)',
    generate (level, opts = {}) {
      const rand = mulberry32(opts.seed ?? Date.now())
      const noise = makeNoise(rand)
      const detail = makeNoise(rand)
      const { width, height, length } = level
      const water = Math.floor(height / 2)
      const heights = new Int16Array(width * length)

      for (let x = 0; x < width; x++) {
        for (let z = 0; z < length; z++) {
          let n = noise(x / 64, z / 64, 5) * 0.8 + detail(x / 16, z / 16, 2) * 0.2
          if (opts.island) {
            const dx = (x / width) * 2 - 1; const dz = (z / length) * 2 - 1
            const edge = Math.min(1, Math.sqrt(dx * dx + dz * dz))
            n = n * 0.6 + 0.35 - edge * 0.9
          }
          const h = Math.max(1, Math.min(height - 2, Math.floor(water + n * height * 0.35)))
          heights[x + z * width] = h
          for (let y = 0; y <= h; y++) {
            let block = 1
            if (y === 0) block = 7
            else if (y === h) block = h < water + 2 ? 12 : 2
            else if (y > h - 4) block = h < water + 2 ? 12 : 3
            level.setBlockRaw(x, y, z, block)
          }
          for (let y = h + 1; y < water; y++) level.setBlockRaw(x, y, z, 9)
          if (h < water && level.getBlock(x, h, z) === 2) level.setBlockRaw(x, h, z, 3)
        }
      }

      // trees
      const trees = Math.floor(width * length / 700)
      for (let i = 0; i < trees; i++) {
        const x = 2 + Math.floor(rand() * (width - 4))
        const z = 2 + Math.floor(rand() * (length - 4))
        const h = heights[x + z * width]
        if (level.getBlock(x, h, z) !== 2 || h + 7 >= height) continue
        tree(level, x, h + 1, z, rand)
      }

      // flowers
      for (let i = 0; i < trees * 2; i++) {
        const x = Math.floor(rand() * width); const z = Math.floor(rand() * length)
        const h = heights[x + z * width]
        if (level.getBlock(x, h, z) === 2 && level.getBlock(x, h + 1, z) === 0) level.setBlockRaw(x, h + 1, z, rand() < 0.5 ? 37 : 38)
      }

      // spawn on the highest point near the center
      let best = { x: width / 2, z: length / 2, h: 0 }
      for (let dx = -16; dx <= 16; dx++) {
        for (let dz = -16; dz <= 16; dz++) {
          const x = Math.floor(width / 2) + dx; const z = Math.floor(length / 2) + dz
          if (x < 0 || z < 0 || x >= width || z >= length) continue
          const h = heights[x + z * width]
          if (h >= water && (best.h < water || Math.abs(dx) + Math.abs(dz) < Math.abs(best.x - width / 2) + Math.abs(best.z - length / 2))) best = { x, z, h }
        }
      }
      level.spawn = { x: best.x + 0.5, y: Math.max(best.h, water) + 2, z: best.z + 0.5, yaw: 0, pitch: 0 }
    }
  }
}

function tree (level, x, y, z, rand) {
  const trunk = 4 + Math.floor(rand() * 2)
  for (let dy = trunk - 2; dy <= trunk + 1; dy++) {
    const r = dy >= trunk ? 1 : 2
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && rand() < 0.5) continue
        if (level.inBounds(x + dx, y + dy, z + dz) && level.getBlock(x + dx, y + dy, z + dz) === 0) level.setBlockRaw(x + dx, y + dy, z + dz, 18)
      }
    }
  }
  for (let dy = 0; dy < trunk; dy++) level.setBlockRaw(x, y + dy, z, 17)
}

generators.biomes = {
  description: 'Plains, forests, deserts and snowy mountains with rivers, caves and ores (seeded)',
  generate (level, opts = {}) {
    const seed = opts.seed ?? Date.now()
    require('./biomes').generate(level, { seed, rand: mulberry32(seed), makeNoise })
  }
}

// aliases
generators.nature = generators.biomes
generators.natural = generators.terrain
generators.hills = generators.terrain
generators.water = generators.ocean

module.exports = { generators, mulberry32, makeNoise }
