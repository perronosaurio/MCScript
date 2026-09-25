'use strict'

// Custom 3D models (CPE CustomModels v2). Comes with a few examples and loads your own from
// config/plugins/custom-models/*.json. Use them with /model <name> or on bots (/bot model).
//
// Model format (sizes in pixels, 16 = one block; uv in pixels of the skin):
// { "name": "mymodel", "nameY": 34, "eyeY": 26, "collision": [8, 28, 8],
//   "flags": { "usesHumanSkin": true, "calcHumanAnims": false },
//   "parts": [{ "min": [-4, 0, -4], "max": [4, 8, 4], "origin": [0, 0, 0], "rotation": [0, 0, 0],
//               "uv": { "top": [u1, v1, u2, v2], "bottom": [...], "front": [...], "back": [...], "left": [...], "right": [...] },
//               "anims": [{ "type": "spin", "axis": "y", "a": 1 }] }] }

const fs = require('fs')
const path = require('path')

// UV boxes of the standard 64x64 skin
const box = (u, v, w, h, d) => ({
  top: [u + d, v, u + d + w, v + d],
  bottom: [u + d + w, v, u + d + w * 2, v + d],
  front: [u + d, v + d, u + d + w, v + d + h],
  back: [u + d * 2 + w, v + d, u + d * 2 + w * 2, v + d + h],
  left: [u + d + w, v + d, u + d * 2 + w, v + d + h],
  right: [u, v + d, u + d, v + d + h]
})
const HEAD = box(0, 0, 8, 8, 8)
const BODY = box(16, 16, 8, 12, 4)
const ARM = box(40, 16, 4, 12, 4)
const LEG = box(0, 16, 4, 12, 4)

const EXAMPLES = [
  {
    name: 'cube',
    nameY: 18,
    eyeY: 12,
    collision: [14, 16, 14],
    pickMin: [-8, 0, -8],
    pickMax: [8, 16, 8],
    flags: { usesHumanSkin: true },
    parts: [{ min: [-8, 0, -8], max: [8, 16, 8], uv: HEAD }]
  },
  {
    name: 'spinner',
    nameY: 18,
    eyeY: 12,
    collision: [14, 16, 14],
    pickMin: [-8, 0, -8],
    pickMax: [8, 16, 8],
    flags: { usesHumanSkin: true },
    parts: [{ min: [-8, 0, -8], max: [8, 16, 8], origin: [0, 8, 0], uv: HEAD, anims: [{ type: 'spin', axis: 'y', a: 1.5 }] }]
  },
  {
    name: 'bighead',
    nameY: 42,
    eyeY: 32,
    collision: [8, 38, 8],
    pickMin: [-8, 0, -8],
    pickMax: [8, 40, 8],
    flags: { usesHumanSkin: true, calcHumanAnims: true },
    parts: [
      { min: [-8, 24, -8], max: [8, 40, 8], origin: [0, 24, 0], uv: HEAD, anims: [{ type: 'head', axis: 'x', a: 1 }] },
      { min: [-4, 12, -2], max: [4, 24, 2], uv: BODY },
      { min: [-8, 12, -2], max: [-4, 24, 2], origin: [-6, 22, 0], uv: ARM, anims: [{ type: 'rightArmX', axis: 'x', a: 1 }, { type: 'rightArmZ', axis: 'z', a: 1 }] },
      { min: [4, 12, -2], max: [8, 24, 2], origin: [6, 22, 0], uv: ARM, anims: [{ type: 'leftArmX', axis: 'x', a: 1 }, { type: 'leftArmZ', axis: 'z', a: 1 }] },
      { min: [-4, 0, -2], max: [0, 12, 2], origin: [-2, 12, 0], uv: LEG, anims: [{ type: 'rightLegX', axis: 'x', a: 1 }] },
      { min: [0, 0, -2], max: [4, 12, 2], origin: [2, 12, 0], uv: LEG, anims: [{ type: 'leftLegX', axis: 'x', a: 1 }] }
    ]
  }
]

module.exports = {
  name: 'custom-models',
  version: '1.0.0',
  description: 'Custom 3D models for players and bots (CustomModels)',
  author: 'MCScript',

  load (ctx) {
    const { server, CommandError } = ctx
    const dir = path.join(server.root, 'config', 'plugins', 'custom-models')
    const loaded = new Set()

    const loadAll = () => {
      for (const m of EXAMPLES) { server.defineModel(m); loaded.add(m.name) }
      if (!fs.existsSync(dir)) return
      for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
        try {
          const model = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
          if (!model.name) model.name = path.basename(file, '.json')
          server.defineModel(model)
          loaded.add(model.name.toLowerCase())
        } catch (err) {
          ctx.log.warn(`Could not load model ${file}: ${err.message}`)
        }
      }
    }
    loadAll()
    ctx.onUnload(() => { for (const name of loaded) server.removeModel(name) })

    // make the models usable with /model
    const essentials = server.plugins.get('core-essentials')
    if (essentials) {
      const allowed = essentials.ctx.config.allowedModels
      for (const name of loaded) if (!allowed.includes(name)) allowed.push(name)
    }

    ctx.command({
      name: 'cmodel',
      aliases: ['custommodels'],
      category: 'other',
      usage: '/cmodel <list|reload>',
      description: 'Lists the custom models (use them with /model <name>)',
      run (player, args, { usage }) {
        const sub = (args[0] || 'list').toLowerCase()
        if (sub === 'list') {
          player.message(`&eCustom models: &f${[...server.customModels.keys()].join(', ') || 'none'}`)
          if (!player.isConsole && !player.supports('CustomModels', 2)) player.message('&7(Your client does not support custom models.)')
          return
        }
        if (sub === 'reload') {
          if (player.permission < server.ranks.permissionOf('Admin')) throw new CommandError('Only admins can reload models.')
          loadAll()
          return player.message(`&aLoaded ${loaded.size} models.`)
        }
        return usage()
      }
    })
  }
}
