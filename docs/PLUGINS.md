# Guía de plugins de MCScript

Un plugin es un archivo `plugins/<nombre>.js` o una carpeta `plugins/<nombre>/index.js` que exporta un objeto:

```js
module.exports = {
  name: 'mi-plugin',          // obligatorio
  version: '1.0.0',
  description: 'Qué hace',
  author: 'Tu nombre',
  depends: ['warps'],         // plugins que deben cargarse antes (opcional)
  defaultConfig: { ... },     // se guarda en config/plugins/mi-plugin.json
  load (ctx) { ... },         // obligatorio
  unload (ctx) { ... }        // opcional
}
```

Se cargan todos los plugins de la carpeta `plugins/` al arrancar (salvo los de `disabledPlugins` en
`config/server.json`). En el juego: `/plugins`, `/pload <nombre>`, `/punload <nombre>`, `/preload <nombre>`
(recarga el código y la configuración) y `/pcreate <nombre>` (crea uno desde la plantilla).

Todo lo que registres a través de `ctx` (comandos, eventos, temporizadores) **se elimina automáticamente** al
descargar el plugin, así que recargarlo no deja nada duplicado.

## El contexto (`ctx`)

| Propiedad / método | Descripción |
| --- | --- |
| `ctx.server` | El servidor (ver abajo) |
| `ctx.config` | Configuración del plugin (`defaultConfig` + `config/plugins/<nombre>.json`) |
| `ctx.saveConfig()` | Guarda `ctx.config` en disco |
| `ctx.log.info/warn/error/debug(...)` | Registro con el prefijo del plugin |
| `ctx.command(def)` | Registra un comando (ver abajo) |
| `ctx.on(evento, handler, { priority })` | Escucha un evento; devuelve una función para dejar de escuchar |
| `ctx.setInterval(fn, ms)` / `ctx.setTimeout(fn, ms)` / `ctx.clearTimer(t)` | Temporizadores que se limpian solos |
| `ctx.loadData(archivo, porDefecto)` / `ctx.saveData(archivo, datos)` | JSON persistente en `data/plugins/<nombre>/` |
| `ctx.onUnload(fn)` | Limpieza extra al descargar |
| `ctx.getPlugin(nombre)` | La API (`module.exports.api`) de otro plugin |
| `ctx.text` | Utilidades de texto: `wrap`, `sanitize`, `stripColors`, `parseColor`, `parseDuration`, `formatDuration`… |
| `ctx.Blocks` | IDs y nombres de bloques, `parse`, `coreDefinition`, constantes de colisión/dibujo/sonido |
| `ctx.CommandError` | Lanza `new ctx.CommandError('mensaje')` en un comando para mostrar un error en rojo |

## Comandos

```js
ctx.command({
  name: 'curar',
  aliases: ['heal'],
  category: 'essentials',   // essentials, chat, moderation, building, world, blocks, server, other
  rank: 'Builder',          // rango mínimo (por defecto el rango por defecto)
  usage: '/curar [jugador]',
  description: 'Texto para /help',
  help: ['Líneas extra para /help curar'],
  inGame: true,             // no se puede usar desde la consola
  async run (player, args, { raw, label, usage }) {
    if (!args[0]) return usage()          // muestra "Usage: ..."
    const target = ctx.server.findPlayer(args[0], player)
    if (!target) return                    // findPlayer ya avisó al jugador
    target.message('&a¡Curado!')
  }
})
```

`run` puede ser `async` (por ejemplo para esperar una selección de bloques). Los dueños del servidor pueden
cambiar el rango de cualquier comando con `/cmdset <comando> <rango>`.

## Eventos

```js
ctx.on('playerChat', (ev) => {
  if (ev.message.includes('palabrota')) ev.cancel('&cCuida tu lenguaje')
}, { priority: 'high' })
```

Prioridades (en orden): `critical`, `high`, `normal`, `low`, `monitor`. Cuando un evento se cancela, solo los
handlers `monitor` siguen ejecutándose (útil para registros o relays; comprueban `ev.cancelled`).

| Evento | Datos | Cancelable |
| --- | --- | --- |
| `playerConnecting` | `name, ip, player` | Sí (`ev.cancel('motivo')` lo desconecta) |
| `playerJoin` | `player` | — |
| `playerLeave` | `player, reason` | — |
| `playerSpawn` | `player, level, from` | — |
| `playerChat` | `player, message` (modificable), `format` (línea completa opcional) | Sí |
| `playerCommand` | `player, label, command, args, raw` | Sí |
| `playerMove` | `player, from, to, yaw, pitch` (posiciones en unidades de 1/32 de bloque) | Sí (lo devuelve atrás) |
| `playerClick` | `player, button, action, yaw, pitch, targetEntity, target {x,y,z,face}` | — |
| `playerChangeLevel` | `player, from, to` | Sí |
| `playerRankChange` | `name, from, to, by` | — |
| `playerAbort` | `player` (usó /abort) | — |
| `blockPermission` | `player, level, x, y, z, oldBlock, block, placing, allowed, message` | Cambia `ev.allowed` para permitir o denegar (antes de `blockChange`) |
| `blockChange` | `player, level, x, y, z, oldBlock, block` (modificable), `placing` | Sí (se revierte) |
| `drawOperation` | `player, level, changes` (filtrable), `name` | Sí |
| `levelLoad` / `levelSave` | `level` | — |
| `levelUnload` | `level` | Sí |
| `tabListEntry` | `player, listName, groupName, groupRank` (modificables) | — |
| `heartbeat` | `params` (URLSearchParams) | Sí |
| `explosion` | `level, x, y, z, radius` (plugin physics) | — |
| `pluginMessage` | `player, channel, data` (Buffer de 64 bytes, CPE PluginMessages) | — |
| `notifyAction` | `player, action, value` o `position` (CPE NotifyAction: `blockListSelected`, `levelSaved`, `thirdPersonChanged`…) | — |
| `pluginLoad` / `pluginUnload` | `plugin` | — |
| `serverStart` / `serverStop` | `server` | — |

## El servidor (`ctx.server`)

- `server.online`: jugadores conectados. `server.findPlayer(nombre, quienPregunta)` y `server.findPlayerExact(nombre)`.
- `server.broadcast(mensaje, filtro?, tipo?)`.
- `server.levels`: `main`, `get(nombre)`, `load`, `create(nombre, { width, height, length, type, seed })`,
  `save`, `unload`, `delete`, `backup`, `listFiles()`.
- `server.ranks`: `get(nombre|número)`, `all`, `default`, `permissionOf(rango)`.
- `server.playerDB`: `get(nombre)`, `getOrCreate`, `find(parcial)`, `all()`, `save()`.
- `server.setRank(nombre, rango, por)`.
- `server.commands.execute(jugador, '/comando args')`.
- `server.blockPerms.canPlace(jugador, bloque)` / `canDelete`.
- Bloques personalizados: `server.setGlobalBlock(def)`, `server.removeGlobalBlock(id)`, `server.setLevelBlock(level, def)`,
  `server.removeLevelBlock(level, id)`.
- Entidades (NPCs): `server.createEntity({ name, skin, model, level, x, y, z, yaw, pitch, scale })`,
  `moveEntity`, `rotateEntity`, `updateEntity`, `removeEntity`, `entitiesIn(level)`.
- Modelos 3D: `server.defineModel({ name, parts, ... })` (formato en `plugins/custom-models/index.js`), `server.removeModel(name)`.
- Partículas: `server.defineParticle(nombre, { tint, count, size, speed, gravity, lifetime, ... })` y
  `server.spawnParticles(level, nombre, x, y, z)`.
- `server.createConsoleActor(nombre, alRecibirMensaje)`: ejecuta comandos con poder de consola y captura la salida.
- `server.log.subscribe(fn)`: recibe cada línea del registro.
- `server.config` y `server.saveConfig()`.

## Mapas (`Level`)

- `level.name, width, height, length, spawn, env, motd, buildRank, visitRank`.
- `level.getBlock(x, y, z)`, `level.setBlock(x, y, z, bloque)` (lo envía a los jugadores),
  `level.setBlocks([[x, y, z, bloque], ...])` (usa BulkBlockUpdate), `level.getAt(indice)` / `level.index(x, y, z)`.
  Los IDs van de 0 a 767 (con ExtendedBlocks); los clientes antiguos reciben el bloque de reemplazo.
- `level.owners` (nombres en minúsculas) y `level.canBuild(jugador)`.
- `level.parseBlock('piedra' | '1')`, `level.blockName(id)`, `level.getBlockDef(id)`.
- `level.meta`: objeto libre para tus datos; **se guarda dentro del archivo `.cw`** (lo usan zones, portals y bots).
- `level.players`, `level.dirty = true` para forzar el guardado.
- Tras cambiar `level.env`, llama a `p.sendEnv()` para cada jugador del mapa.

## Jugadores (`Player`)

- `player.name, rank, permission, level, record` (datos persistentes), `data` (datos temporales de la sesión).
- `player.message(texto, tipo?)`. Tipos: `chat`, `status1-3` (arriba a la derecha), `bottom1-3` (abajo a la
  derecha), `announce`, `bigAnnounce`, `smallAnnounce` (centro de la pantalla).
- `player.teleport(x, y, z, yaw?, pitch?)` (en bloques), `teleportTo(otro)`, `changeLevel(level)`,
  `blockPos`, `feetPos`.
- `player.kick(motivo)`.
- `await player.selectBlocks(n, etiqueta)`: pide al jugador marcar n bloques (lanza error si usa /abort).
- CPE: `supports('Extensión')`, `setModel(modelo, persistir = true)`, `setSkin`, `holdBlock`, `setHotbar`, `setReach`,
  `setHacks`, `setVelocity`, `setSpawnpoint`, `showSelection(id, etiqueta, p1, p2, [r, g, b, a])`, `hideSelection`,
  `setTextHotKey`, `setCinematic({ hideHotbar, hideHand, hideCrosshair, color, barSize })`, `toggleBlockList(abrir)`,
  `sendPluginMessage(canal, datos)`, `sendEnv`, `pingMs`.

## APIs de los plugins incluidos

Con `ctx.getPlugin(nombre)` puedes usar lo que exportan otros plugins (declara `depends` si lo necesitas siempre):

| Plugin | API |
| --- | --- |
| `economy` | `balance(nombre)`, `add(nombre, n)`, `take(nombre, n)` (devuelve `false` si no alcanza), `setBalance`, `currency` |
| `physics` | `explode(level, x, y, z, radio)`, `schedule(level, x, y, z)`, `modeOf(level)` |
| `zones` | `zonesAt(level, x, y, z)`, `canBuild(jugador, level, x, y, z)` |
| `core-building` | `apply(jugador, level, cambios, nombre)` (dibujar respetando permisos y undo), `history` |
| `minigames` | `games.tntwars / ctf / zombie` con sus rondas (`rounds`, `roundOf(jugador)`) |

## Instalar plugins de otros

`/pinstall <url>` descarga un plugin de un solo archivo (los enlaces de GitHub se convierten a la versión "raw") y
`/pinstall npm:paquete` lo instala desde npm en `plugins/<nombre>/`. `/puninstall <plugin>` lo mueve a
`plugins/.removed`. Solo el rango Owner puede usarlos: instala únicamente código en el que confíes.

## Plugins del formato 1.x

Los plugins antiguos (`module.exports.server = (server, settings) => {}`) no son compatibles y se ignoran con un
aviso. Conviértelos a este formato: el código de `server(...)` va en `load(ctx)` y los handlers de jugador se
sustituyen por eventos (`playerJoin`, `playerChat`, …).
