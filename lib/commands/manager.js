'use strict'

const fs = require('fs')

class CommandError extends Error {}

// Registry of commands. Plugins register commands through their context (ctx.command(...)),
// which removes them automatically when the plugin is unloaded.
class CommandManager {
  constructor (server, overridesFile) {
    this.server = server
    this.commands = new Map() // name -> def
    this.aliases = new Map() // alias -> name
    this.overridesFile = overridesFile
    this.overrides = {}
    if (overridesFile && fs.existsSync(overridesFile)) {
      try { this.overrides = JSON.parse(fs.readFileSync(overridesFile, 'utf8')) } catch (err) {}
    }
  }

  register (def) {
    if (!def || !def.name || typeof def.run !== 'function') throw new Error('Command needs a name and a run(player, args) function')
    const name = def.name.toLowerCase()
    if (this.commands.has(name)) throw new Error(`Command /${name} is already registered (by ${this.commands.get(name).owner || 'core'})`)
    const cmd = {
      aliases: [],
      rank: null,
      usage: `/${name}`,
      description: '',
      category: 'other',
      inGame: false,
      ...def,
      name
    }
    this.commands.set(name, cmd)
    for (const alias of cmd.aliases) {
      const a = alias.toLowerCase()
      if (!this.commands.has(a) && !this.aliases.has(a)) this.aliases.set(a, name)
    }
    return () => this.unregister(name)
  }

  unregister (name) {
    name = name.toLowerCase()
    const cmd = this.commands.get(name)
    if (!cmd) return false
    this.commands.delete(name)
    for (const [alias, target] of this.aliases) if (target === name) this.aliases.delete(alias)
    return true
  }

  removeOwner (owner) {
    for (const cmd of [...this.commands.values()]) if (cmd.owner === owner) this.unregister(cmd.name)
  }

  find (name) {
    if (!name) return null
    name = name.toLowerCase()
    return this.commands.get(name) || this.commands.get(this.aliases.get(name)) || null
  }

  // minimum permission number required to use a command
  permissionFor (cmd) {
    const override = this.overrides[cmd.name]
    return this.server.ranks.permissionOf(override !== undefined ? override : cmd.rank)
  }

  canUse (player, cmd) {
    return player.permission >= this.permissionFor(cmd)
  }

  setOverride (name, rank) {
    this.overrides[name] = rank
    if (this.overridesFile) fs.writeFileSync(this.overridesFile, JSON.stringify(this.overrides, null, 2))
  }

  available (player) {
    return [...this.commands.values()].filter(c => this.canUse(player, c)).sort((a, b) => a.name.localeCompare(b.name))
  }

  // Executes "/name args..." (the leading slash is optional)
  async execute (player, line) {
    line = String(line).trim().replace(/^\//, '')
    if (!line) return
    const space = line.indexOf(' ')
    const label = (space === -1 ? line : line.slice(0, space)).toLowerCase()
    const raw = space === -1 ? '' : line.slice(space + 1).trim()
    const args = raw.length ? raw.split(/\s+/) : []

    const cmd = this.find(label)
    const ev = this.server.events.fire('playerCommand', { player, label, command: cmd, args, raw })
    if (ev.cancelled) {
      if (ev.cancelReason) player.message(ev.cancelReason)
      return
    }
    if (!cmd) return player.message(`&cUnknown command "/${label}". Type &f/help&c for a list of commands.`)
    if (!this.canUse(player, cmd)) {
      const rank = this.server.ranks.get(this.permissionFor(cmd))
      return player.message(`&cOnly ${rank ? rank.color + rank.name : 'higher ranks'}&c+ can use /${cmd.name}.`)
    }
    if (cmd.inGame && player.isConsole) return player.message(`&c/${cmd.name} can only be used in-game.`)

    if (!player.isConsole) {
      this.server.log.info(`${player.name} used /${label}${raw ? ' ' + raw : ''}`)
      player.data.lastCommand = { line: `/${label}${raw ? ' ' + raw : ''}`, at: Date.now() }
    }
    try {
      await cmd.run(player, args, { raw, label, cmd, usage: () => player.message(`&cUsage: &f${cmd.usage}`) })
    } catch (err) {
      if (err instanceof CommandError) {
        player.message('&c' + err.message)
      } else {
        player.message(`&cAn error occurred while running /${cmd.name}: ${err.message}`)
        this.server.log.error(`Error in /${cmd.name}:`, err)
      }
    }
  }
}

module.exports = { CommandManager, CommandError }
