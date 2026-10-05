'use strict'

// "biomes" generator: rolling plains, forests, deserts and snowy mountains, with rivers, beaches,
// caves and ores. Seeded, so the same seed gives the same world.

// block ids
const B = { air: 0, stone: 1, grass: 2, dirt: 3, cobble: 4, sapling: 6, bedrock: 7, water: 9, lava: 11, sand: 12, gravel: 13, goldOre: 14, ironOre: 15, coalOre: 16, log: 17, leaves: 18, green: 25, dandelion: 37, rose: 38, brownMush: 39, redMush: 40, mossy: 48, sandstone: 52, snow: 53, ice: 60 }

function generate (level, { seed, rand, makeNoise }) {
  const { width, height, length } = level
  const sea = Math.floor(height * 0.42)
  const continent = makeNoise(rand)
  const detail = makeNoise(rand)
  const mountains = makeNoise(rand)
  const ridges = makeNoise(rand)
  const rivers = makeNoise(rand)
  const heat = makeNoise(rand)
  const wet = makeNoise(rand)

  const heights = new Int16Array(width * length)
  const biome = new Uint8Array(width * length) // 0 plains, 1 forest, 2 desert, 3 snow, 4 water
  const set = (x, y, z, b) => level.setBlockRaw(x, y, z, b)
  const get = (x, y, z) => level.getBlock(x, y, z)

  for (let x = 0; x < width; x++) {
    for (let z = 0; z < length; z++) {
      const base = continent(x / 180, z / 180, 4) * 0.8 + detail(x / 40, z / 40, 3) * 0.2
      const mask = Math.max(0, Math.min(1, (mountains(x / 140, z / 140, 3) + 0.05) * 2.2)) ** 2
      const ridge = 1 - Math.abs(ridges(x / 55, z / 55, 4))
      let h = sea + base * height * 0.2 + mask * ridge * height * 0.42
      // rivers cut through everything but the high mountains
      const r = Math.abs(rivers(x / 160, z / 160, 3))
      if (r < 0.04 && h < sea + height * 0.25) h = Math.min(h, sea - 1 - (0.04 - r) * 60 + r * 40)
      h = Math.max(4, Math.min(height - 12, Math.floor(h)))
      heights[x + z * width] = h

      const temp = heat(x / 220, z / 220, 2) - Math.max(0, h - sea) / height * 1.6
      const moist = wet(x / 160, z / 160, 2)
      let kind = 0
      if (h < sea) kind = 4
      else if (temp < -0.32 || h > sea + height * 0.3) kind = 3
      else if (temp > 0.22 && moist < 0) kind = 2
      else if (moist > 0.08) kind = 1
      biome[x + z * width] = kind

      // column: bedrock, stone with ores, soil, surface
      set(x, 0, z, B.bedrock)
      if (rand() < 0.5) set(x, 1, z, B.bedrock)
      for (let y = 1; y <= h; y++) {
        if (get(x, y, z) === B.bedrock) continue
        let b = B.stone
        const depth = h - y
        const beach = h <= sea + 1 && h >= sea - 2 && kind !== 3
        if (kind === 2 || beach) b = depth < 3 ? B.sand : depth < 6 ? B.sandstone : B.stone
        else if (kind === 3 && h > sea + height * 0.3) b = depth === 0 ? B.snow : B.stone
        else if (kind === 4) b = depth < 2 ? (rand() < 0.3 ? B.gravel : B.sand) : depth < 4 ? B.dirt : B.stone
        else if (depth === 0) b = kind === 3 ? B.snow : B.grass
        else if (depth < 4) b = B.dirt
        if (b === B.stone) {
          const roll = rand()
          if (roll < 0.012 && y < sea + 20) b = B.coalOre
          else if (roll < 0.018 && y < sea - 4) b = B.ironOre
          else if (roll < 0.0205 && y < sea / 2) b = B.goldOre
          else if (roll < 0.03) b = B.gravel
        }
        set(x, y, z, b)
      }
      // water, frozen on top in cold places
      for (let y = h + 1; y <= sea - 1; y++) set(x, y, z, B.water)
      if (h < sea - 1 && temp < -0.32) set(x, sea - 1, z, B.ice)
    }
  }

  // caves: worms that wander underground and carve tunnels
  const worms = Math.floor(width * length / 1800)
  for (let w = 0; w < worms; w++) {
    let x = rand() * width; let z = rand() * length
    let y = 6 + rand() * (heights[Math.floor(x) + Math.floor(z) * width] - 14)
    let yaw = rand() * Math.PI * 2; let pitch = (rand() - 0.5) * 0.4
    const steps = 60 + Math.floor(rand() * 120)
    for (let s = 0; s < steps; s++) {
      yaw += (rand() - 0.5) * 0.5
      pitch = Math.max(-0.5, Math.min(0.5, pitch + (rand() - 0.5) * 0.2))
      x += Math.cos(yaw) * Math.cos(pitch); z += Math.sin(yaw) * Math.cos(pitch); y += Math.sin(pitch)
      if (x < 2 || z < 2 || x >= width - 2 || z >= length - 2 || y < 3) break
      const r = 1.3 + Math.sin(s / 9) * 0.6 + rand() * 0.5
      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
          for (let dz = -3; dz <= 3; dz++) {
            if (dx * dx + dy * dy + dz * dz > r * r) continue
            const cx = Math.floor(x + dx); const cy = Math.floor(y + dy); const cz = Math.floor(z + dz)
            if (cx < 0 || cz < 0 || cx >= width || cz >= length || cy < 2) continue
            const top = heights[cx + cz * width]
            if (cy > top - 3 || top < sea) continue // keep the surface and the sea floor whole
            set(cx, cy, cz, cy <= 5 ? B.lava : B.air)
          }
        }
      }
    }
  }

  // plants
  const surface = (x, z) => heights[x + z * width]
  for (let x = 3; x < width - 3; x++) {
    for (let z = 3; z < length - 3; z++) {
      const h = surface(x, z)
      const kind = biome[x + z * width]
      const top = get(x, h, z)
      if (get(x, h + 1, z) !== 0 || h + 12 >= height) continue
      const roll = rand()
      if (top === B.grass) {
        const treeChance = kind === 1 ? 0.03 : 0.0025
        if (roll < treeChance) {
          const pick = rand()
          if (kind === 1 && pick < 0.35) pine(level, x, h + 1, z, rand)
          else if (pick < 0.12) bigOak(level, x, h + 1, z, rand)
          else oak(level, x, h + 1, z, rand)
        } else if (roll < treeChance + 0.05) {
          set(x, h + 1, z, kind === 1 && rand() < 0.3 ? (rand() < 0.5 ? B.brownMush : B.redMush) : rand() < 0.75 ? B.sapling : rand() < 0.5 ? B.rose : B.dandelion)
        }
      } else if (top === B.snow && kind === 3 && roll < 0.008 && h < sea + height * 0.3) {
        pine(level, x, h + 1, z, rand, true)
      } else if (top === B.sand && kind === 2 && roll < 0.004) {
        const tall = 1 + Math.floor(rand() * 3)
        for (let i = 1; i <= tall; i++) set(x, h + i, z, B.green) // cactus
      }
    }
  }

  // spawn on dry, mild land close to the middle
  let best = null
  for (let r = 0; r < Math.max(width, length) / 2 && !best; r += 2) {
    for (let a = 0; a < 32 && !best; a++) {
      const x = Math.floor(width / 2 + Math.cos(a / 32 * Math.PI * 2) * r)
      const z = Math.floor(length / 2 + Math.sin(a / 32 * Math.PI * 2) * r)
      if (x < 4 || z < 4 || x >= width - 4 || z >= length - 4) continue
      const h = surface(x, z)
      if ((biome[x + z * width] === 0 || biome[x + z * width] === 1) && h > sea + 1 && h < sea + height * 0.15) best = { x, z, h }
    }
  }
  if (!best) best = { x: Math.floor(width / 2), z: Math.floor(length / 2), h: Math.max(sea, surface(Math.floor(width / 2), Math.floor(length / 2))) }
  level.spawn = { x: best.x + 0.5, y: best.h + 1, z: best.z + 0.5, yaw: 0, pitch: 0 }
  level.meta.seed = seed
}

function leafBlob (level, cx, cy, cz, r, rand) {
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const d = dx * dx + dy * dy * 1.6 + dz * dz
        if (d > r * r + 0.5 || (d > (r - 0.5) * (r - 0.5) && rand() < 0.35)) continue
        const x = cx + dx; const y = cy + dy; const z = cz + dz
        if (level.inBounds(x, y, z) && level.getBlock(x, y, z) === 0) level.setBlockRaw(x, y, z, B.leaves)
      }
    }
  }
}

function oak (level, x, y, z, rand) {
  const h = 4 + Math.floor(rand() * 3)
  for (let i = 0; i < h; i++) level.setBlockRaw(x, y + i, z, B.log)
  leafBlob(level, x, y + h - 1, z, 2, rand)
}

function bigOak (level, x, y, z, rand) {
  const h = 7 + Math.floor(rand() * 4)
  for (let i = 0; i < h; i++) level.setBlockRaw(x, y + i, z, B.log)
  leafBlob(level, x, y + h, z, 3, rand)
  for (let b = 0; b < 3; b++) {
    const dx = Math.round((rand() - 0.5) * 6); const dz = Math.round((rand() - 0.5) * 6)
    const by = y + h - 3 + Math.floor(rand() * 2)
    for (let s = 1; s <= 2; s++) {
      const bx = x + Math.round(dx * s / 3); const bz = z + Math.round(dz * s / 3)
      if (level.inBounds(bx, by + s, bz)) level.setBlockRaw(bx, by + s, bz, B.log)
    }
    leafBlob(level, x + dx, by + 3, z + dz, 2, rand)
  }
}

function pine (level, x, y, z, rand, snowy = false) {
  const h = 7 + Math.floor(rand() * 5)
  for (let i = 0; i < h; i++) level.setBlockRaw(x, y + i, z, B.log)
  for (let i = 2; i <= h; i++) {
    const r = Math.max(0, Math.round((h - i) / 3.2 + (i % 2 ? 0.4 : 0)))
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue
        const lx = x + dx; const lz = z + dz; const ly = y + i
        if (!level.inBounds(lx, ly, lz) || level.getBlock(lx, ly, lz) !== 0) continue
        level.setBlockRaw(lx, ly, lz, B.leaves)
        if (snowy && level.inBounds(lx, ly + 1, lz) && level.getBlock(lx, ly + 1, lz) === 0 && rand() < 0.6) level.setBlockRaw(lx, ly + 1, lz, B.snow)
      }
    }
  }
  if (level.inBounds(x, y + h + 1, z)) level.setBlockRaw(x, y + h + 1, z, B.leaves)
}

module.exports = { generate }
