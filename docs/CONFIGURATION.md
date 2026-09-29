# Configuration

Everything lives in `config/`, which is created the first time the server starts. The files are plain JSON:
stop the server (or use the matching in-game command) before editing them by hand, otherwise the server may
write its own copy over your changes on shutdown.

## config/server.json

| Key | Default | What it does |
| --- | --- | --- |
| `name` | `MCScript Server` | Server name shown on the server list and the loading screen |
| `motd` | `Welcome! Server made in JavaScript` | Second line of the loading screen. Hack flags such as `-hax` or `+fly` go here too |
| `host` | `0.0.0.0` | Address to listen on. `0.0.0.0` means every network interface |
| `port` | `25565` | TCP port for both the desktop and the web client |
| `maxPlayers` | `20` | Operators and above can still join when the server is full |
| `maxConnectionsPerIp` | `5` | Open connections allowed from one address. `0` turns the limit off |
| `public` | `false` | List the server on classicube.net |
| `verifyNames` | `true` | Check with classicube.net that players are who they say they are |
| `heartbeatUrl` | classicube.net | Where heartbeats are sent |
| `heartbeatInterval` | `45` | Seconds between heartbeats |
| `extraHeartbeats` | `[]` | More server lists to announce the server on, such as BetaCraft. See below |
| `allowWebClient` | `true` | Accept the browser client (WebSocket on the same port) |
| `trustProxy` | `false` | Use the `X-Forwarded-For` header as the player IP. Only turn this on behind your own reverse proxy |
| `mainLevel` | `main` | Level players spawn in |
| `defaultRank` | `Guest` | Rank given to new players |
| `owners` | `[]` | Names that always get the highest rank |
| `welcomeMessage` | | Sent to players when they join. `{player}` is replaced with their name |
| `rules` | three lines | Shown by `/rules` |
| `defaultTexture` | `""` | Texture pack URL for levels that don't set their own |
| `autosaveMinutes` | `5` | `0` turns autosave off |
| `backupMinutes` | `30` | How often changed levels are backed up. `0` turns backups off |
| `backupsToKeep` | `10` | Backups kept per level |
| `maxClickDistance` | `5` | Reach in blocks (`/reach` can change it per player) |
| `chatColorsRank` | `Guest` | Lowest rank that can use `%` color codes in chat |
| `disabledPlugins` | `[]` | Plugins that are not loaded at startup |
| `customColors` | `{}` | Extra color codes, for example `{ "q": "#ff8800" }`. Managed with `/ccols` |
| `database` | `json` | `json` or `sqlite`. See below |
| `checkForUpdates` | `true` | Look for a newer MCScript release on GitHub at startup and say so in the console |
| `logToFile` | `true` | Write logs to `logs/` |
| `debug` | `false` | Extra log output |

### Environment variables

Environment variables, or a `.env` file next to `package.json`, override `server.json`. That is handy for
containers and hosting panels.

| Variable | Key |
| --- | --- |
| `PORT` | `port` |
| `HOST` | `host` |
| `SERVER_NAME` | `name` |
| `MOTD` | `motd` |
| `MAX_PLAYERS` | `maxPlayers` |
| `PUBLIC` | `public` (`true` or `1`) |
| `VERIFY_NAMES` or `ONLINE_MODE` | `verifyNames` |
| `MAIN_LEVEL` | `mainLevel` |
| `OWNERS` | `owners` (comma separated) |
| `DATABASE` | `database` |
| `DEBUG` | `debug` |

## Name verification

With `verifyNames` on, the server sends a heartbeat to classicube.net even when `public` is `false`. The
heartbeat registers a secret salt; the game client gets a matching key when you click the server on
classicube.net, and the server checks it on login. That stops people from joining under someone else's name.

Connections from `127.0.0.1` skip the check, so you can always join your own server locally. Players who type
the IP address by hand, without going through classicube.net, are refused. Turn `verifyNames` off only for
private LAN games. With it off, anyone can join as anyone, including as one of the `owners`.

## BetaCraft and other server lists

The server can be listed on more than one server list at the same time, like MCGalaxy. Add them to
`extraHeartbeats`. For [BetaCraft](https://betacraft.uk), which lets people play with the original Minecraft
Classic 0.30 client and a Minecraft account:

```json
"extraHeartbeats": [
  { "url": "<BetaCraft heartbeat URL>", "nameSuffix": "+", "mojangAuth": true }
]
```

Get the heartbeat address from betacraft.uk. Each entry takes:

- `url`: where to send the heartbeat. Every list gets its own salt, and a player is accepted if their key
  matches any of them.
- `nameSuffix`: added to the name of everyone who logs in through that list. `Notch` on ClassiCube and `Notch`
  on BetaCraft are different people; with `"+"` the BetaCraft one becomes `Notch+`, so they never share ranks,
  bans or data. Use it whenever you have more than one list.
- `skinPrefix`: put in front of the skin name of those players, if their skins come from somewhere else.
- `mojangAuth`: also accept players that Mojang's session server vouches for. BetaCraft's launcher signs in
  with a Minecraft account and tells Mojang it is joining before it connects; this is how the server checks it.

Owners and ranks refer to the full name, so a BetaCraft owner goes in `owners` as `Name+`.

## Clients

- **ClassiCube** (desktop, mobile and browser) gets everything.
- **ViaFabricPlus** (a mod that lets modern Minecraft Java join classic servers) understands only a few CPE
  extensions. The server notices and falls back automatically: custom blocks become their fallback block,
  and particles, models, environment colors and similar features are simply not sent.
- **Minecraft Classic 0.30** (for example from the BetaCraft launcher) works without any extensions.

Older Classic versions (before 0.30) use a different protocol and can't join. With ViaFabricPlus, choose the
Classic 0.30 version with CPE in its version list.

## Ranks (config/ranks.json)

Each rank has a numeric `permission`. Commands, blocks and levels ask for a minimum rank, and anyone with that
number or higher passes.

```json
{ "name": "Builder", "permission": 30, "color": "&2", "prefix": "", "drawLimit": 50000, "maxUndo": 20000 }
```

- `drawLimit`: the most blocks one `/cuboid`, `/fill`, `/paste` and so on may change.
- `maxUndo`: how many of their own block changes a player can undo.
- A rank with a negative permission is banned.

The default ranks are Banned (-20), Guest (0), Builder (30), AdvBuilder (50), Operator (80), Admin (100) and
Owner (120). You can rename them, add more or change the numbers. The `Operator` and `Owner` names are used as
defaults for some commands, so keep ranks with those names or adjust the command ranks with `/cmdset`.

## Command and block permissions

- `config/commands.json`: set with `/cmdset <command> <rank>`.
- `config/blockperms.json`: set with `/blockset <block> <rank>`. Covers placing and deleting.

## Turning plugins on and off

Every feature beyond the core commands is a plugin, including the `core-*` ones, so you can switch off anything
you don't want:

- In game or in the console: `/pdisable <plugin>` and `/penable <plugin>` (Owner only). `/plugins` shows what
  is on, off or broken.
- In the web panel: the Turn off / Turn on links in the Plugins block.
- By hand: list the plugin names in `disabledPlugins` in `server.json` while the server is stopped.

All three do the same thing: the plugin is unloaded right away and stays off after a restart. Plugins that
depend on another plugin are turned off with it. Commands from a plugin that is off simply don't exist, so
`/help` never shows them.

## Plugin settings

Each plugin writes its defaults to `config/plugins/<plugin>.json` the first time it loads. Edit the file and
run `/preload <plugin>` to apply it. Plugin data (warps, balances, records) lives in `data/plugins/<plugin>/`.

## SQLite

The default `players.json` is fine for a few thousand players. For more, set `"database": "sqlite"`. It uses
the `node:sqlite` module that ships with Node.js, so there is nothing to install. The existing `players.json` is
imported the first time. `data/players.db` is then the file to back up.

## Files you should back up

- `config/`: settings, ranks and permissions
- `levels/` (including `levels/backups/`)
- `data/`: players, custom blocks, plugin data and block history

`logs/` and `plugins/.removed/` can go.
