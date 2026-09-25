'use strict'

// Helpers for CustomModels (v2) and CustomParticles.
// Model definitions use "pixels" (1/16 of a block) like Blockbench; they are converted to blocks here.

const FACES = ['top', 'bottom', 'front', 'back', 'left', 'right']
const ANIMS = {
  none: 0,
  head: 1,
  leftLegX: 2,
  rightLegX: 3,
  leftArmX: 4,
  leftArmZ: 5,
  rightArmX: 6,
  rightArmZ: 7,
  spin: 8,
  spinVelocity: 9,
  sinRotate: 10,
  sinRotateVelocity: 11,
  sinTranslate: 12,
  sinTranslateVelocity: 13,
  sinSize: 14,
  sinSizeVelocity: 15,
  flipRotate: 16,
  flipRotateVelocity: 17,
  flipTranslate: 18,
  flipTranslateVelocity: 19,
  flipSize: 20,
  flipSizeVelocity: 21
}
const AXES = { x: 0, y: 1, z: 2 }
const px = v => (Number(v) || 0) / 16

// Returns the packets that define a model on a client
function modelPackets (id, model) {
  const f = model.flags || {}
  const flags = (f.bobbing !== false ? 1 : 0) | (f.pushes !== false ? 2 : 0) | (f.usesHumanSkin !== false ? 4 : 0) | (f.calcHumanAnims ? 8 : 0)
  const [cx, cy, cz] = model.collision || [8, 28, 8]
  const pickMin = model.pickMin || [-4, 0, -4]
  const pickMax = model.pickMax || [4, 32, 4]
  const parts = model.parts || []
  const packets = [['defineModel', {
    modelId: id,
    modelName: model.name,
    flags,
    nameY: px(model.nameY ?? 32.5),
    eyeY: px(model.eyeY ?? 26),
    collisionX: px(cx),
    collisionY: px(cy),
    collisionZ: px(cz),
    pickMinX: px(pickMin[0]),
    pickMinY: px(pickMin[1]),
    pickMinZ: px(pickMin[2]),
    pickMaxX: px(pickMax[0]),
    pickMaxY: px(pickMax[1]),
    pickMaxZ: px(pickMax[2]),
    uScale: model.uScale || 64,
    vScale: model.vScale || 64,
    numParts: parts.length
  }]]
  for (const part of parts) {
    const uv = Buffer.alloc(48)
    FACES.forEach((face, i) => {
      const [u1, v1, u2, v2] = (part.uv && part.uv[face]) || [0, 0, 0, 0]
      uv.writeUInt16BE(u1, i * 8)
      uv.writeUInt16BE(v1, i * 8 + 2)
      uv.writeUInt16BE(u2, i * 8 + 4)
      uv.writeUInt16BE(v2, i * 8 + 6)
    })
    const anims = Buffer.alloc(68)
    ;(part.anims || []).slice(0, 4).forEach((a, i) => {
      const o = i * 17
      const type = typeof a.type === 'number' ? a.type : (ANIMS[a.type] || 0)
      anims[o] = (type & 0x3F) | ((AXES[a.axis] ?? 0) << 6)
      anims.writeFloatBE(a.a || 0, o + 1)
      anims.writeFloatBE(a.b || 0, o + 5)
      anims.writeFloatBE(a.c || 0, o + 9)
      anims.writeFloatBE(a.d || 0, o + 13)
    })
    const [x1, y1, z1] = part.min || [0, 0, 0]
    const [x2, y2, z2] = part.max || [0, 0, 0]
    const [ox, oy, oz] = part.origin || [0, 0, 0]
    const [rx, ry, rz] = part.rotation || [0, 0, 0]
    packets.push(['defineModelPart', {
      modelId: id,
      minX: px(x1),
      minY: px(y1),
      minZ: px(z1),
      maxX: px(x2),
      maxY: px(y2),
      maxZ: px(z2),
      uv,
      originX: px(ox),
      originY: px(oy),
      originZ: px(oz),
      rotX: rx,
      rotY: ry,
      rotZ: rz,
      anims,
      flags: (part.fullbright ? 1 : 0) | (part.firstPersonArm ? 2 : 0)
    }])
  }
  return packets
}

// Particle effect definition -> DefineEffect packet data
function effectPacket (id, e) {
  const [u1, v1, u2, v2] = e.texture || [0, 0, 7, 7]
  const [r, g, b] = e.tint || [255, 255, 255]
  return {
    effectId: id,
    u1,
    v1,
    u2,
    v2,
    r,
    g,
    b,
    frameCount: e.frames || 1,
    particleCount: e.count || 10,
    size: Math.round((e.size ?? 0.25) * 32),
    sizeVariation: Math.round((e.sizeVariation ?? 0.2) * 10000),
    spread: Math.round((e.spread ?? 0.5) * 32),
    speed: Math.round((e.speed ?? 1) * 10000),
    gravity: Math.round((e.gravity ?? 0) * 10000),
    baseLifetime: Math.round((e.lifetime ?? 1) * 10000),
    lifetimeVariation: Math.round((e.lifetimeVariation ?? 0.3) * 10000),
    // bit 0: expires on touching the ground, 1: solid, 2: liquid and 3: leaves stop it
    collideFlags: (e.collide === false ? 0 : 0x0E) | (e.expireOnGround ? 1 : 0),
    fullBright: e.fullBright ? 1 : 0
  }
}

module.exports = { modelPackets, effectPacket, ANIMS, FACES }
