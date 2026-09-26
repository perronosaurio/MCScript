# MCScript

A ClassiCube / Minecraft Classic server written in JavaScript. It speaks the classic protocol plus CPE, can run
several levels at once, supports custom blocks and texture packs, and most features live in plugins, much like
[MCGalaxy](https://github.com/ClassiCube/MCGalaxy).

No runtime dependencies, just Node.js 20 or newer. Both the desktop [ClassiCube](https://github.com/ClassiCube/ClassiCube)
client and the web client work (the web client connects over WebSocket on the same port). With `public` turned on
the server shows up on the classicube.net server list and player names are verified.

## Getting started

```bash
npm install   # only dev tools (linter)
npm start
```

On the first run these get created:

| Path | What's in it |
| --- | --- |
| `config/server.json` | name, MOTD, port, max players, owners... |
| `config/ranks.json` | ranks (Guest, Builder, AdvBuilder, Operator, Admin, Owner) |
| `config/blockperms.json` | which rank can place/delete each block |
| `config/commands.json` | command rank overrides (`/cmdset`) |
| `config/plugins/*.json` | plugin settings |
| `config/text/*.txt` | `/faq`, `/news`, `/oprules` and anything for `/view` |
| `levels/*.cw` | levels, in ClassicWorld format |
| `data/` | player data, global custom blocks, plugin data |
| `logs/` | one log file per day |

You can also use environment variables or a `.env` file (see `.env.example`): `PORT`, `SERVER_NAME`, `MOTD`,
`MAX_PLAYERS`, `PUBLIC`, `ONLINE_MODE`, `OWNERS`, `DATABASE`.

Put your ClassiCube name in `owners` to get the top rank. The console accepts commands (`/rank Someone Admin`)
and `stop` shuts the server down after saving.

For big servers set `"database": "sqlite"` (needs Node 22.5+). Existing `players.json` data is imported the first time.

Upgrading from MCScript 1.x: the old `levels/level.dat` is converted to `levels/main.cw` on first start. The old
code in `src/` and `client.js` is no longer used.

## What it does

Protocol
- Classic 0.30 and 38 CPE extensions, including CustomBlocks, BlockDefinitions/BlockDefinitionsExt, ExtendedBlocks
  (block ids up to 767), ExtEntityPositions (levels over 1023 blocks), BulkBlockUpdate, FastMap, EnvColors,
  EnvMapAspect, EnvWeatherType, ExtPlayerList, ChangeModel, CustomModels, CustomParticles, CinematicGui,
  SelectionCuboid, HackControl, MessageTypes, LongerMessages, FullCP437, TextColors, PlayerClick, VelocityControl,
  EntityProperty, PluginMessages, NotifyAction and ToggleBlockList.
- Clients without an extension get sensible fallbacks (for example a replacement block for custom blocks).

Levels
- Several loaded at once. Generators: `flat`, `empty`, `pixel`, `space`, `ocean`, `island`, `terrain` (seeded).
- ClassicWorld `.cw` files; MCGalaxy `.lvl` and the old `.dat` can be imported.
- Autosave, periodic backups with `/restore`, deleted levels go to `levels/deleted`.
- Per level: sky/fog/cloud/light colors, texture pack, weather, edge blocks, water level, MOTD hack flags
  (`-hax +fly`), build and visit ranks, owners, physics, lockdown.
- Block history is written to disk, so `/about` and `/undoplayer` still work after a restart.

Custom blocks: `/gb` for all levels and `/lb` for one level. Name, textures per face, shape, collision, speed, sound,
light, transparency, fog and fallback block. A few presets are included (invisible barrier, lamp, glass pane,
ladder, carpet, slabs, speed pad...).

Players and moderation: numeric rank permissions, draw and undo limits per rank, temp bans and IP bans, mutes,
warnings, temp ranks, reports, whitelist, moderated chat, staff chats, freeze, vanish, anti-spam and anti-grief.

## Bundled plugins

| Plugin | Commands |
| --- | --- |
| core-essentials | `/spawn /main /tp /tphere /back /ascend /descend /tpa /kill /msg /reply /ignore /me /say /announce /rules /faq /news /view /players /whois /top /search /blocks /pclients /whonick /serverinfo /ping /where /time /model /modelscale /entityrot /skin /nick /color /title /tcolor /hold /reach /fly /afk /clear /roll /8ball /hug /high5 /send /inbox /loginmessage /logoutmessage /emotes /ccols /lastcmd` |
| core-moderation | `/rank /promote /demote /ranks /rankinfo /temprank /kick /warn /ban /unban /baninfo /banedit /banip /unbanip /xban /bans /mute /unmute /freeze /vanish /follow /p2p /patrol /moveall /moderate /voice /opchat /adminchat /rankmsg /report /whitelist /playeredit /limit /sudo /oprules` |
| core-worlds | `/newlvl /goto /levels /load /unload /save /deletelvl /copylvl /renamelvl /resizelvl /import /mapinfo /map /setspawn /backup /restore /lockdown /reload /fixgrass /unflood /env /weather /texture` |
| core-building | `/cuboid /replace /replaceall /line /sphere /spheroid /torus /pyramid /hollow /outline /fill /tree /maze /rainbow /drill /center /place /copy /paste /mirror /spin /write /mark /bind /mode /undo /undoplayer /redo /paint /about /measure /calculate` |
| core-blocks | `/gb /lb` |
| warps | `/warp /home` |
| zones | `/zone` (protected areas, shown in the client) |
| portals | `/portal /mb` (portals between levels, message and command blocks) |
| bots | `/bot` (NPCs with skin, model, scale and simple AI) |
| physics | `/physics` (falling sand, flowing water and lava, sponges, TNT) |
| economy | `/money /pay /baltop /eco /give /take /shop /buy` |
| minigames | `/parkour /tntwars /ctf /zombie` |
| effects | `/effect /cinematic /blocklist /explode /slap` |
| custom-models | `/cmodel` (example 3D models plus your own JSON ones, used with `/model`) |
| announcer | `/announcer` |
| relay-irc | IRC chat bridge (off by default) |
| relay-discord | Discord chat bridge, webhook or bot (off by default) |
| web-panel | admin panel in the browser (off by default) |
| example | a commented example plugin |

Core commands: `/help /plugins /plugin /pload /punload /preload /pcreate /pinstall /puninstall /cmdset /blockset /abort /stop /restart`.

Add a plugin to `disabledPlugins` in `config/server.json` to turn it off. `relay-irc`, `relay-discord` and
`web-panel` start disabled: set `"enabled": true` in their file in `config/plugins/` and run `/preload <plugin>`.

### Minigames

An operator turns a level into an arena and players join with `/<game> join`.

- Parkour: `/parkour setstart`, `/parkour addcheckpoint`, `/parkour setfinish` (mark the blocks you stand on).
  Timer, checkpoints and records with `/parkour top`.
- TNT Wars: `/tntwars enable`, `/tntwars setspawn red|blue`. Right click to drop TNT, first team to the score limit wins.
- Capture the Flag: `/ctf enable`, `/ctf setflag red|blue`, `/ctf setspawn red|blue`. Take the other team's flag
  home; click an enemy to tag them.
- Zombie Survival: `/zombie enable`. One player starts as a zombie and infects others by touching them.

The arena is restored after each round, and with the economy plugin the winners get coins.

### Web panel

With `web-panel` enabled it listens on `127.0.0.1:8080`. Open `http://127.0.0.1:8080/` and log in with the token
from `config/plugins/web-panel.json` to see players, levels, plugins, the live log and a console.

## Writing plugins

```bash
npm run plugin:create MyPlugin     # or /pcreate MyPlugin in game
```

```js
module.exports = {
  name: 'greetings',
  version: '1.0.0',
  defaultConfig: { message: '&aHi, {player}!' },
  load (ctx) {
    ctx.command({
      name: 'hi',
      usage: '/hi',
      run (player) { player.message(ctx.config.message.replace('{player}', player.name)) }
    })
    ctx.on('blockChange', (ev) => {
      if (ev.block === 46) ev.cancel('&cNo TNT here')
    })
  }
}
```

Other people's plugins can be installed with `/pinstall https://github.com/user/repo/blob/main/plugin.js` or
`/pinstall npm:package-name` (install scripts are not run). The full API is in [docs/PLUGINS.md](docs/PLUGINS.md).

## Development

```bash
npm test         # unit and integration tests (simulated clients)
npm run lint     # JavaScript Standard Style
```

```
index.js              entry point
lib/
  server.js           server, entities, tab list, custom models and particles
  player.js           a connected player: login, CPE, level transfer, movement, blocks, chat
  protocol/           classic + CPE packets and CP437
  network/            TCP and WebSocket
  level/              levels, .cw format, importers, generators
  commands/           command manager and core commands
  plugins/            plugin loader, installer and template
  storage/            player database (JSON or SQLite)
plugins/              bundled plugins
test/                 tests
```
