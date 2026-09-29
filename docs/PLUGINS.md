# Writing plugins

A plugin is either a file `plugins/<name>.js` or a folder `plugins/<name>/index.js` that exports an object:

```js
module.exports = {
  name: 'my-plugin',          // required
  version: '1.0.0',
  description: 'What it does',
  author: 'You',
  depends: ['warps'],         // plugins that must be loaded first (optional)
  defaultConfig: { ... },     // saved to config/plugins/my-plugin.json
  load (ctx) { ... },         // required
  unload (ctx) { ... }        // optional
}
```

Every plugin in `plugins/` is loaded at startup, except the ones listed in `disabledPlugins` in
`config/server.json`. In game you have `/plugins`, `/pload <name>`, `/punload <name>`, `/preload <name>` (reloads
the code and the config) and `/pcreate <name>` (creates one from the template). `/plugin <list|load|unload|...>`
works too, like in MCGalaxy.

Anything you register through `ctx` (commands, event handlers, timers) is removed when the plugin is unloaded,
so reloading a plugin never leaves duplicates behind.

## The context (`ctx`)

| Property / method | |
| --- | --- |
| `ctx.server` | the server (see below) |
| `ctx.config` | plugin settings (`defaultConfig` merged with `config/plugins/<name>.json`) |
| `ctx.saveConfig()` | writes `ctx.config` back to disk |
| `ctx.log.info/warn/error/debug(...)` | logging, prefixed with the plugin name |
| `ctx.command(def)` | registers a command (see below) |
| `ctx.on(event, handler, { priority })` | listens to an event; returns a function that stops listening |
| `ctx.setInterval(fn, ms)` / `ctx.setTimeout(fn, ms)` / `ctx.clearTimer(t)` | timers that are cleared on unload |
| `ctx.loadData(file, defaults)` / `ctx.saveData(file, data)` | JSON files in `data/plugins/<name>/`. Loaded objects have no prototype, so player-chosen keys such as `constructor` are safe to use |
| `ctx.onUnload(fn)` | extra cleanup on unload |
| `ctx.getPlugin(name)` | another plugin's API (its `module.exports.api`) |
| `ctx.text` | text helpers: `wrap`, `sanitize`, `stripColors`, `parseColor`, `parseDuration`, `formatDuration`... |
| `ctx.Blocks` | block ids and names, `parse`, `coreDefinition`, collide/draw/sound constants |
| `ctx.CommandError` | throw `new ctx.CommandError('message')` in a command to show it in red |

## Commands

```js
ctx.command({
  name: 'heal',
  aliases: ['h'],
  category: 'essentials',   // essentials, chat, moderation, building, world, blocks, server, other
  rank: 'Builder',          // lowest rank that can use it (default: the default rank)
  usage: '/heal [player]',
  description: 'Shown in /help',
  help: ['Extra lines for /help heal'],
  inGame: true,             // can't be used from the console
  async run (player, args, { raw, label, usage }) {
    if (!args[0]) return usage()          // prints "Usage: ..."
    const target = ctx.server.findPlayer(args[0], player)
    if (!target) return                    // findPlayer already told the player
    target.message('&aHealed!')
  }
})
```

`run` can be `async` (for example to wait for the player to mark blocks). Owners can change the rank of any
command with `/cmdset <command> <rank>`.

## Events

```js
ctx.on('playerChat', (ev) => {
  if (ev.message.includes('badword')) ev.cancel('&cWatch your language')
}, { priority: 'high' })
```

Priorities run in this order: `critical`, `high`, `normal`, `low`, `monitor`. Once an event is cancelled only
`monitor` handlers still run (handy for logging or chat relays; check `ev.cancelled`).

| Event | Fields | Cancel |
| --- | --- | --- |
| `playerConnecting` | `name, ip, player` | yes, `ev.cancel('reason')` disconnects them |
| `playerJoin` | `player` | |
| `playerLeave` | `player, reason` | |
| `playerSpawn` | `player, level, from` | |
| `playerChat` | `player, message` (can be changed), `format` (optional full line) | yes |
| `playerCommand` | `player, label, command, args, raw` | yes |
| `playerMove` | `player, from, to, yaw, pitch` (positions in 1/32 of a block) | yes, moves them back |
| `playerClick` | `player, button, action, yaw, pitch, targetEntity, target {x,y,z,face}` | |
| `playerChangeLevel` | `player, from, to` | yes |
| `playerRankChange` | `name, from, to, by` | |
| `playerAbort` | `player` (used /abort) | |
| `blockPermission` | `player, level, x, y, z, oldBlock, block, placing, allowed, message` | set `ev.allowed` to allow or deny (runs before `blockChange`) |
| `blockChange` | `player, level, x, y, z, oldBlock, block` (can be changed), `placing` | yes, the block is reverted |
| `drawOperation` | `player, level, changes` (can be filtered), `name` | yes |
| `levelLoad` / `levelSave` | `level` | |
| `levelUnload` | `level` | yes |
| `tabListEntry` | `player, listName, groupName, groupRank` (can be changed) | |
| `heartbeat` | `params` (URLSearchParams) | yes |
| `explosion` | `level, x, y, z, radius` (physics plugin) | |
| `pluginMessage` | `player, channel, data` (64 byte Buffer, CPE PluginMessages) | |
| `notifyAction` | `player, action, value` or `position` (CPE NotifyAction: `blockListSelected`, `levelSaved`, `thirdPersonChanged`...) | |
| `pluginLoad` / `pluginUnload` | `plugin` | |
| `serverStart` / `serverStop` | `server` | |

## The server (`ctx.server`)

- `server.online`: connected players. `server.findPlayer(name, askedBy)` and `server.findPlayerExact(name)`.
- `server.broadcast(message, filter?, type?)`.
- `server.levels`: `main`, `get(name)`, `load`, `create(name, { width, height, length, type, seed })`, `save`,
  `unload`, `delete`, `copy`, `rename`, `resize`, `backup`, `listFiles()`.
- `server.ranks`: `get(name | number)`, `all`, `default`, `permissionOf(rank)`, `save()`.
- `server.playerDB`: `get(name)`, `getOrCreate`, `find(partial)`, `all()`, `save()`.
- `server.setRank(name, rank, by)`.
- `server.commands.execute(player, '/command args')`.
- `server.blockPerms.canPlace(player, block)` / `canDelete`.
- Custom blocks: `server.setGlobalBlock(def)`, `server.removeGlobalBlock(id)`, `server.setLevelBlock(level, def)`,
  `server.removeLevelBlock(level, id)`.
- Entities (NPCs): `server.createEntity({ name, skin, model, level, x, y, z, yaw, pitch, scale })`,
  `moveEntity`, `rotateEntity`, `updateEntity`, `removeEntity`, `entitiesIn(level)`.
- 3D models: `server.defineModel({ name, parts, ... })` (the format is described in
  `plugins/custom-models/index.js`) and `server.removeModel(name)`.
- Particles: `server.defineParticle(name, { tint, count, size, speed, gravity, lifetime, ... })` and
  `server.spawnParticles(level, name, x, y, z)`.
- `server.createConsoleActor(name, onMessage)`: runs commands with console rights and captures what they print.
- `server.log.subscribe(fn)`: receives every log line.
- `server.config` and `server.saveConfig()`.

## Levels

- `level.name, width, height, length, spawn, env, motd, buildRank, visitRank`.
- `level.getBlock(x, y, z)`, `level.setBlock(x, y, z, block)` (sent to the players),
  `level.setBlocks([[x, y, z, block], ...])` (uses BulkBlockUpdate), `level.getAt(index)` / `level.index(x, y, z)`.
  Block ids go from 0 to 767 (ExtendedBlocks); older clients get the fallback block.
- `level.owners` (lowercase names) and `level.canBuild(player)`.
- `level.parseBlock('stone' | '1')`, `level.blockName(id)`, `level.getBlockDef(id)`.
- `level.meta` is free for your own data and is saved inside the `.cw` file (zones, portals and bots use it).
- `level.players`; set `level.dirty = true` to make sure it gets saved.
- After changing `level.env`, call `p.sendEnv()` for every player in the level.

## Players

- `player.name, rank, permission, level, record` (saved data), `data` (session only).
- `player.message(text, type?)`. Types: `chat`, `status1-3` (top right), `bottom1-3` (bottom right),
  `announce`, `bigAnnounce`, `smallAnnounce` (middle of the screen).
- `player.teleport(x, y, z, yaw?, pitch?)` (in blocks), `teleportTo(other)`, `changeLevel(level)`, `blockPos`,
  `feetPos`, `previousPosition`.
- `player.kick(reason)`.
- `await player.selectBlocks(n, label)` asks the player to mark n blocks (throws if they use /abort);
  `player.addMark(x, y, z)` adds a mark from code.
- CPE: `supports('ExtName')`, `setModel(model, persist = true)`, `setSkin`, `holdBlock`, `setHotbar`, `setReach`,
  `setHacks`, `setVelocity`, `setSpawnpoint`, `showSelection(id, label, p1, p2, [r, g, b, a])`, `hideSelection`,
  `setTextHotKey`, `setCinematic({ hideHotbar, hideHand, hideCrosshair, color, barSize })`, `toggleBlockList(open)`,
  `sendPluginMessage(channel, data)`, `sendEnv`, `pingMs`.

## APIs of the bundled plugins

`ctx.getPlugin(name)` gives you what another plugin exports (add it to `depends` if you always need it):

| Plugin | API |
| --- | --- |
| `economy` | `balance(name)`, `add(name, n)`, `take(name, n)` (returns `false` if they can't afford it), `setBalance`, `currency` |
| `physics` | `explode(level, x, y, z, radius)`, `schedule(level, x, y, z)`, `modeOf(level)` |
| `zones` | `zonesAt(level, x, y, z)`, `canBuild(player, level, x, y, z)` |
| `core-building` | `apply(player, level, changes, name)` (draws with permission checks and undo), `history` |
| `minigames` | `games.tntwars / ctf / zombie` and their rounds (`rounds`, `roundOf(player)`) |

## Installing other people's plugins

`/pinstall <url>` downloads a single file plugin over HTTPS (GitHub page links are turned into raw links) and
`/pinstall npm:package` installs one from npm into `plugins/<name>/`. `/puninstall <plugin>` moves it to
`plugins/.removed`. Only Owners can use them. Only install code you trust.

## Plugins from MCScript 1.x

Old plugins (`module.exports.server = (server, settings) => {}`) don't work anymore and are skipped with a
warning. To port one, move the body of `server(...)` into `load(ctx)` and replace the per player handlers with
events (`playerJoin`, `playerChat`...).
