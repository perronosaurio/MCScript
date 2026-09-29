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
