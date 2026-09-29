'use strict'

const fs = require('fs')

// Which rank may place / delete each block. Stored in config/blockperms.json as
// { "7": { "place": "Operator", "delete": "Operator" }, ... }. Missing blocks use the default rank.
const DEFAULT_PERMS = {
  7: { place: 'Operator', delete: 'Operator' }, // bedrock
  8: { place: 'AdvBuilder' }, // water
  10: { place: 'AdvBuilder' }, // lava
  9: { place: 'Builder' }, // still water
  11: { place: 'Builder' }, // still lava
  46: { place: 'Builder' } // TNT
}

class BlockPermissions {
  constructor (server, file) {
    this.server = server
    this.file = file
    if (file && fs.existsSync(file)) {
      this.perms = JSON.parse(fs.readFileSync(file, 'utf8'))
    } else {
      this.perms = JSON.parse(JSON.stringify(DEFAULT_PERMS))
      if (file) this.save()
    }
  }

  save () {
    if (this.file) fs.writeFileSync(this.file, JSON.stringify(this.perms, null, 2))
  }

  required (block, action) {
    const entry = this.perms[block]
    return this.server.ranks.permissionOf(entry && entry[action] ? entry[action] : null)
  }

  canPlace (player, block) { return player.permission >= this.required(block, 'place') }

  canDelete (player, block) { return player.permission >= this.required(block, 'delete') }

  set (block, action, rank) {
    this.perms[block] = this.perms[block] || {}
    this.perms[block][action] = rank
    this.save()
    for (const p of this.server.players) if (p.spawned) p.sendBlockPermissions()
  }
}

module.exports = { BlockPermissions, DEFAULT_PERMS }
