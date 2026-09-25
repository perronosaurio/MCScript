# MCScript

Servidor de **ClassiCube / Minecraft Classic** escrito en JavaScript (Node.js), con soporte completo del protocolo
**CPE** (Classic Protocol Extension), múltiples mapas, bloques personalizados, texturas, rangos y un sistema de
**plugins** inspirado en [MCGalaxy](https://github.com/ClassiCube/MCGalaxy).

- Sin dependencias en tiempo de ejecución: solo Node.js 20 o superior.
- Compatible con el cliente de escritorio de [ClassiCube](https://github.com/ClassiCube/ClassiCube) y con el
  **cliente web** (WebSocket en el mismo puerto).
- Aparece en la lista pública de [classicube.net](https://www.classicube.net/server/list/) (heartbeat) con verificación de nombres.

## Inicio rápido

```bash
npm install        # solo instala herramientas de desarrollo (linter)
npm start
```

La primera vez se crean:

| Carpeta | Contenido |
| --- | --- |
| `config/server.json` | Nombre, MOTD, puerto, jugadores máximos, dueños, etc. |
| `config/ranks.json` | Rangos (Guest, Builder, AdvBuilder, Operator, Admin, Owner…) |
| `config/blockperms.json` | Qué rango puede colocar/romper cada bloque |
| `config/commands.json` | Cambios de rango mínimo de comandos (`/cmdset`) |
| `config/plugins/*.json` | Configuración de cada plugin |
| `levels/*.cw` | Mapas en formato ClassicWorld (compatible con ClassiCube y MCGalaxy) |
| `data/` | Jugadores, bloques globales y datos de plugins |
| `logs/` | Registro diario |

Los valores también se pueden cambiar con variables de entorno o un archivo `.env` (ver `.env.example`):
`PORT`, `SERVER_NAME`, `MOTD`, `MAX_PLAYERS`, `PUBLIC`, `ONLINE_MODE`, `OWNERS`…

Pon tu nombre de ClassiCube en `owners` (en `config/server.json`) para tener el rango más alto.
Desde la consola del servidor puedes escribir comandos (`/rank Nombre Admin`) o `stop` para apagar guardando todo.

> **Migración desde MCScript 1.x:** el antiguo `levels/level.dat` se convierte automáticamente en `levels/main.cw`
> la primera vez que arranca. El código antiguo (`src/`, `client.js`) ya no se usa y se puede borrar.

## Funciones

**Protocolo y cliente**
- Classic 0.30 + 30 extensiones CPE: CustomBlocks, BlockDefinitions(+Ext), BulkBlockUpdate, FastMap, EnvColors,
  EnvMapAspect (texturas), EnvWeatherType, ExtPlayerList v2 (lista de jugadores y skins), ChangeModel, HeldBlock,
  SetHotbar, ClickDistance, HackControl, SelectionCuboid, BlockPermissions, MessageTypes, LongerMessages,
  FullCP437, TextColors, TwoWayPing, InstantMOTD, PlayerClick, VelocityControl, EntityProperty, SetSpawnpoint,
  TextHotKey, InventoryOrder, LightingMode, EmoteFix.
- Los clientes sin CPE (o sin bloques personalizados) reciben bloques de reemplazo automáticamente.
- Cliente web por WebSocket en el mismo puerto.

**Mundos**
- Múltiples mapas cargados a la vez, con generadores `flat`, `empty`, `pixel`, `space`, `ocean`, `island` y `terrain` (con semilla).
- Formato `.cw` (ClassicWorld); importación de `.lvl` de MCGalaxy y del `.dat` antiguo.
- Guardado automático, copias de seguridad periódicas con restauración y papelera (`levels/deleted`).
- Por mapa: colores del cielo/niebla/nubes/sombra/sol, texture pack, clima, bloques de borde, nivel del agua,
  MOTD con flags de hacks (`-hax +fly`), rango para construir y para visitar.

**Bloques personalizados**
- `/gb` (globales) y `/lb` (por mapa): nombre, texturas por cara, forma/caja, colisión, velocidad, sonido, brillo,
  transparencia, niebla, bloque de reemplazo… Incluye presets (barrera invisible, lámpara, vidrio fino, escalera,
  alfombra, losas, plataforma de velocidad…).

**Jugadores y moderación**
- Rangos con permisos numéricos, colores, prefijos, límite de dibujo y de undo por rango.
- Baneos (temporales, por IP), silenciar, congelar, invisibilidad, antispam y anti-grief.
- Base de datos de jugadores: primera/última conexión, tiempo jugado, bloques, IPs, apodos, títulos, colores, modelos y skins.

## Plugins incluidos

| Plugin | Comandos |
| --- | --- |
| **core-essentials** | `/spawn /main /tp /tphere /msg /reply /ignore /me /say /announce /rules /players /whois /serverinfo /ping /where /time /model /skin /nick /color /title /hold /reach /fly /afk` |
| **core-moderation** | `/rank /promote /demote /ranks /kick /ban /unban /banip /unbanip /bans /mute /unmute /freeze /vanish` + antispam |
| **core-worlds** | `/newlvl /goto /levels /load /unload /save /deletelvl /import /mapinfo /map /setspawn /backup /restore /env /weather /texture` |
| **core-building** | `/cuboid /replace /replaceall /line /sphere /fill /place /copy /paste /undo /redo /paint /about /measure` |
| **core-blocks** | `/gb /lb` |
| **warps** | `/warp /home` |
| **zones** | `/zone` (áreas protegidas, visibles en el cliente) |
| **portals** | `/portal /mb` (portales entre mapas y bloques de mensaje/comando) |
| **bots** | `/bot` (NPCs con skin, modelo, tamaño y IA simple) |
| **announcer** | `/announcer` (mensajes automáticos) |
| **relay-irc** | Puente de chat con IRC (desactivado por defecto) |
| **relay-discord** | Puente de chat con Discord por webhook o bot (desactivado por defecto) |
| **example** | Plugin de ejemplo comentado para aprender la API |

Comandos del núcleo: `/help /plugins /pload /punload /preload /pcreate /cmdset /blockset /abort /stop`.

Para desactivar un plugin añádelo a `disabledPlugins` en `config/server.json` (o usa `/punload`).

## Crear plugins

```bash
npm run plugin:create MiPlugin     # o /pcreate MiPlugin dentro del juego
```

```js
module.exports = {
  name: 'saludos',
  version: '1.0.0',
  defaultConfig: { mensaje: '&a¡Hola, {player}!' },
  load (ctx) {
    ctx.command({
      name: 'hola',
      usage: '/hola',
      run (player) { player.message(ctx.config.mensaje.replace('{player}', player.name)) }
    })
    ctx.on('blockChange', (ev) => {
      if (ev.block === 46) ev.cancel('&cNada de TNT aquí')
    })
  }
}
```

Guía completa de la API: [docs/PLUGINS.md](docs/PLUGINS.md).

## Desarrollo

```bash
npm test         # tests unitarios y de integración (clientes simulados)
npm run lint     # estilo JavaScript Standard
```

Estructura:

```
index.js              punto de entrada
lib/
  server.js           servidor, entidades, lista de jugadores
  player.js           conexión de un jugador: login, CPE, mapa, movimiento, bloques, chat
  protocol/           paquetes Classic + CPE y CP437
  network/            TCP + WebSocket
  level/              mapas, formato .cw, importadores, generadores
  commands/           gestor de comandos y comandos del núcleo
  plugins/            cargador de plugins y plantilla
  storage/            base de datos de jugadores (JSON)
plugins/              plugins incluidos
test/                 tests
```
