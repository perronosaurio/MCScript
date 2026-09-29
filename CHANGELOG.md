# Changelog

## 2.0.0 (unreleased)

A rewrite of the whole server. The 1.x code in `src/` and `client.js` is no longer used.

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
