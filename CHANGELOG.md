# Changelog

## Unreleased

## 2.0.0

MCScript is back after seven years. The server was rewritten from scratch; none of the 1.x code (`src/`,
`client.js`) is left, but an old `levels/level.dat` is still converted on the first start.

### Added
- Own Classic protocol 7 and CPE layer with 38 extensions, including BlockDefinitions, ExtendedBlocks,
  ExtEntityPositions, CustomModels and CustomParticles.
- The ClassiCube web client can connect on the same port.
- Several levels loaded at once, ClassicWorld (`.cw`) files, MCGalaxy `.lvl` import and seven generators.
- MCGalaxy style ranks, command and block permissions.
- A plugin system with events, hot reloading and per-plugin config and data, plus `/pinstall`.
- Bundled plugins: essentials, moderation, worlds, building, custom blocks, warps, zones, portals, bots,
  physics, economy, minigames, effects, custom models, announcer, IRC and Discord relays, and a web panel.
- Optional SQLite player database.
- `/pdisable` and `/penable` (also on the web panel) turn bundled or installed plugins off and on, and the
  choice is kept after a restart.
- The web panel got a new look based on the ClassiCube forum.
- The server checks GitHub for a newer release when it starts (`checkForUpdates`).

### Changed
- Needs Node.js 22.13 or newer. No runtime dependencies.
- Settings moved to `config/server.json`, with `.env` overrides.
- Licensed under the MIT License.

### Fixed
- Every player was treated as an operator.
- `/kick` without a reason crashed the server.
- The level was sent before the player was verified.
- Entity ids overflowed after many logins.

### Security
- Player names and plugin data keys like `__proto__` can no longer pollute object prototypes.
- Limit on connections per IP address (`maxConnectionsPerIp`), stricter WebSocket frame handling, and an
  error in a packet handler now kicks that player instead of stopping the server.
- Name verification now works on servers that are not public (the heartbeat still registers the salt).
- `/pinstall` only downloads over HTTPS, caps the download size and validates npm package names.
- New installs no longer make the original authors owners, and servers are not listed publicly until you
  turn it on.

## 1.0.1

The original MCScript.
