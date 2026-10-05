# MCScript

[![CI](https://github.com/perronosaurio/MCScript/actions/workflows/main.yml/badge.svg)](https://github.com/perronosaurio/MCScript/actions/workflows/main.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A ClassiCube / Minecraft Classic server written in JavaScript. It speaks the classic protocol plus CPE, runs
several levels at once, supports custom blocks and texture packs, and keeps most features in plugins, much like
[MCGalaxy](https://github.com/ClassiCube/MCGalaxy).

It has no runtime dependencies, only Node.js. Both the desktop [ClassiCube](https://github.com/ClassiCube/ClassiCube)
client and the browser client work; the browser client connects over WebSocket on the same port. Players can
also join with [ViaFabricPlus](https://github.com/ViaVersion/ViaFabricPlus) (modern Minecraft Java) or the
original Classic 0.30 client from [BetaCraft](https://betacraft.uk), and the server can be listed on both
classicube.net and BetaCraft.

- [Requirements](#requirements)
- [Installing](#installing)
- [Your first server](#your-first-server)
- [Letting other people join](#letting-other-people-join)
- [Keeping it running](#keeping-it-running)
- [Updating](#updating)
- [Features](#features)
- [Bundled plugins](#bundled-plugins)
- [Writing plugins](#writing-plugins)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Requirements

- [Node.js](https://nodejs.org) 22.13 or newer. The current LTS release is the safest choice.
- A ClassiCube account to join, from [classicube.net](https://www.classicube.net).

## Installing

With git:

```bash
git clone https://github.com/perronosaurio/MCScript.git
cd MCScript
npm install
```

Without git, download the zip of the latest version from the
[releases page](https://github.com/perronosaurio/MCScript/releases), unpack it and run `npm install` inside the
folder. `npm install` only fetches the linter used for development; the server itself needs nothing else.

## Your first server

```bash
npm start
```

The first start creates `config/`, `levels/`, `data/` and `logs/` and generates a flat main level. Then:

1. Stop the server with `stop` (or Ctrl+C).
2. Open `config/server.json`, set `name` and `motd`, and put your ClassiCube name in `owners`:
   ```json
   "owners": ["YourName"]
   ```
3. Start it again with `npm start`.
4. In ClassiCube pick **Direct connect**, enter your name and `127.0.0.1:25565`, and join. You get the Owner rank.

The server console accepts commands, such as `/rank Someone Builder` or `/newlvl build 256 64 256 flat`. `stop`
saves everything and shuts down.

Every setting is described in [docs/CONFIGURATION.md](docs/CONFIGURATION.md). You can also use environment
variables or a `.env` file (copy `.env.example`).

## Letting other people join

1. Forward TCP port `25565` on your router to the computer running the server, and allow it through the firewall.
2. Set `"public": true` in `config/server.json` and restart.
3. After a minute the server shows up on the [classicube.net server list](https://www.classicube.net/server/list/).
   The console prints its link, which is also saved in `data/externalurl.txt`.

Keep `verifyNames` on. The server then checks with classicube.net that every player really owns their name,
so nobody can join as you. Players must join through the server list or your server link; typing the IP by hand
is refused. Connections from `127.0.0.1` are always allowed.

If you would rather keep the server off the public list, leave `public` off and share the link from
`data/externalurl.txt` with your friends. It works the same way.

## Keeping it running

On a VPS or a home server, run MCScript as a service so it restarts after crashes and reboots.

**Linux with systemd.** Create `/etc/systemd/system/mcscript.service`, changing the user and path:

```ini
[Unit]
Description=MCScript server
After=network-online.target

[Service]
User=mcscript
WorkingDirectory=/home/mcscript/MCScript
ExecStart=/usr/bin/node index.js
Restart=on-failure
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now mcscript
journalctl -u mcscript -f     # live log
```

`KillSignal=SIGINT` gives the server time to save the levels when the service is stopped. Don't run the
server as root. When something else restarts the server (systemd, pm2 or a start script with a loop), set the
environment variable `MCSCRIPT_SUPERVISED=1` (for systemd: `Environment=MCSCRIPT_SUPERVISED=1` under
`[Service]`). `/restart` then just exits and lets the supervisor start it again, instead of starting a second
copy itself.

**Any system with pm2:**

```bash
npm install -g pm2
pm2 start index.js --name mcscript --kill-timeout 10000
pm2 save && pm2 startup
```

The console isn't available as a service. Use the web panel plugin or join the game to run commands.

### Backups

Levels are backed up automatically to `levels/backups/`. `/restore` brings one back in-game. For a complete
backup, copy `config/`, `levels/` and `data/` while the server is stopped, or right after `/save all`.

## Updating

```bash
git pull
npm install
```

Then restart the server. Without git, download the latest zip from the
[releases page](https://github.com/perronosaurio/MCScript/releases) and unpack it over your server folder.
Your `config/`, `levels/` and `data/` folders are never touched by an update. Read the release notes (or
[CHANGELOG.md](CHANGELOG.md)) first; they list anything you need to change. The server tells you in the
console when a new release is out.

Coming from MCScript 1.x: install 2.x in a new folder and copy your old `levels/level.dat` into its `levels/`
folder. It is converted to `levels/main.cw` on the first start. Players and ranks from 1.x were not saved, so
there is nothing else to carry over.

## Features

Protocol
- Classic 0.30 and 38 CPE extensions, including CustomBlocks, BlockDefinitions/BlockDefinitionsExt, ExtendedBlocks
  (block ids up to 767), ExtEntityPositions (levels over 1023 blocks), BulkBlockUpdate, FastMap, EnvColors,
  EnvMapAspect, EnvWeatherType, ExtPlayerList, ChangeModel, CustomModels, CustomParticles, CinematicGui,
  SelectionCuboid, HackControl, MessageTypes, LongerMessages, FullCP437, TextColors, PlayerClick, VelocityControl,
  EntityProperty, PluginMessages, NotifyAction and ToggleBlockList.
- Clients without an extension get sensible fallbacks, for example a replacement block for custom blocks.

Levels
- Several loaded at once. Generators: `flat`, `empty`, `pixel`, `space`, `ocean`, `island`, `terrain` (seeded).
- ClassicWorld `.cw` files. MCGalaxy `.lvl` and the old `.dat` can be imported with `/import`.
- Autosave, periodic backups with `/restore`. Deleted levels go to `levels/deleted`.
- Per level: sky, fog, cloud and light colors, texture pack, weather, edge blocks, water level, MOTD hack flags
  (`-hax +fly`), build and visit ranks, owners, physics and lockdown.
- Block history is written to disk, so `/about` and `/undoplayer` still work after a restart.

Custom blocks: `/gb` for every level and `/lb` for one level. Name, textures per face, shape, collision, speed,
sound, light, transparency, fog and fallback block. Presets included: invisible barrier, lamp, glass pane,
ladder, carpet, slabs, speed pad and more.

Players and moderation: numeric rank permissions, draw and undo limits per rank, temporary and IP bans, mutes,
warnings, temporary ranks, reports, whitelist, moderated chat, staff chats, freeze, vanish, anti-spam and
anti-grief.

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
| relay-discord | Discord bot: chat channel, staff channel and `!commands`, like MCGalaxy's ([guide](docs/DISCORD.md), off by default) |
| web-panel | admin panel in the browser (off by default) |
| example | a commented example plugin |

Core commands: `/help /plugins /plugin /penable /pdisable /pload /punload /preload /pcreate /pinstall /puninstall /cmdset /blockset /abort /stop /restart`.

Everything in this table can be turned off: use `/pdisable <plugin>` (and `/penable` to bring it back), the
switches in the web panel, or `disabledPlugins` in `config/server.json`. The choice survives restarts.
`relay-irc`, `relay-discord` and `web-panel` also need `"enabled": true` in their file in `config/plugins/`
before they do anything; after editing it, run `/preload <plugin>`.

### Minigames

An operator turns a level into an arena, and players join with `/<game> join`.

- Parkour: `/parkour setstart`, `/parkour addcheckpoint`, `/parkour setfinish` (mark the blocks you stand on).
  Timer, checkpoints and records with `/parkour top`.
- TNT Wars: `/tntwars enable`, `/tntwars setspawn red|blue`. Right click to drop TNT. The first team to reach
  the score limit wins.
- Capture the Flag: `/ctf enable`, `/ctf setflag red|blue`, `/ctf setspawn red|blue`. Bring the other team's
  flag home; click an enemy to tag them.
- Zombie Survival: `/zombie enable`. One player starts as a zombie and infects others by touching them.

The arena is restored after each round, and with the economy plugin the winners get coins.

### Web panel

With `web-panel` enabled it listens on `127.0.0.1:8080`. Open `http://127.0.0.1:8080/` and log in with the token
from `config/plugins/web-panel.json` to see players, levels, plugins, the live log and a console. The token
gives full console access. If you open the panel to the internet, put it behind HTTPS.

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
`/pinstall npm:package-name` (install scripts are not run). A plugin runs with the same rights as the server,
so only install code you trust. The full API is in [docs/PLUGINS.md](docs/PLUGINS.md).

## Troubleshooting

**"MCScript needs Node.js 22.13 or newer".** Install the current LTS from [nodejs.org](https://nodejs.org).
`node -v` shows the version you have.

**`EADDRINUSE` on start.** Something else is using port 25565, often another server that's still running.
Stop it or change `port`.

**"Login failed! Close the game and sign in again."** Name verification failed. Join from the server list or
the server link rather than direct connect. After a restart, wait for the first heartbeat (a few seconds)
before joining.

**The server isn't on the list.** Check that `public` is `true` and look for heartbeat errors in the console. A
message about the port means it isn't reachable from outside: check the port forwarding and the firewall.

**Friends on the same network can't join.** Local network addresses are verified like everyone else, so use
the server link. For a LAN-only game you can set `verifyNames` to `false`, but then anyone who can reach the
port can pick any name.

**A plugin broke.** Its errors are in the console and in `logs/`. `/punload <plugin>` turns it off until the
next restart. Add it to `disabledPlugins` to keep it off.

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
docs/                 configuration and plugin API guides
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and [SECURITY.md](SECURITY.md) to
report a security problem privately.

## License

[MIT](LICENSE). MCScript isn't affiliated with Mojang, Microsoft or the ClassiCube project.
