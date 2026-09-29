'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULTS = {
  name: 'MCScript Server',
  motd: 'Welcome! Server made in JavaScript',
  host: '0.0.0.0',
  port: 25565,
  maxPlayers: 20,
  maxConnectionsPerIp: 5,
  public: false,
  verifyNames: true,
  heartbeatUrl: 'https://www.classicube.net/server/heartbeat/',
  heartbeatInterval: 45,
  // more server lists, e.g. BetaCraft: [{ "url": "...", "nameSuffix": "", "skinPrefix": "", "mojangAuth": true }]
  extraHeartbeats: [],
  allowWebClient: true,
  trustProxy: false,
  mainLevel: 'main',
  defaultRank: 'Guest',
  owners: [],
  welcomeMessage: '&eWelcome to the server, &f{player}&e! Type &f/help&e for commands.',
  rules: [
    '&f1. &7Be respectful to other players.',
    '&f2. &7No griefing other people\'s builds.',
    '&f3. &7No spamming or advertising.'
  ],
  defaultTexture: '',
  autosaveMinutes: 5,
  backupMinutes: 30,
  backupsToKeep: 10,
  maxClickDistance: 5,
  chatColorsRank: 'Guest',
  disabledPlugins: [],
  customColors: {},
  database: 'json', // 'json' or 'sqlite'
  checkForUpdates: true,
  logToFile: true,
  debug: false
}

// Environment variables that map onto config keys
const ENV_MAP = {
  PORT: ['port', Number],
  HOST: ['host', String],
  SERVER_NAME: ['name', String],
  MOTD: ['motd', String],
  MAX_PLAYERS: ['maxPlayers', Number],
  PUBLIC: ['public', v => v === 'true' || v === '1'],
  ONLINE_MODE: ['verifyNames', v => v === 'true' || v === '1'],
  VERIFY_NAMES: ['verifyNames', v => v === 'true' || v === '1'],
  MAIN_LEVEL: ['mainLevel', String],
  OWNERS: ['owners', v => v.split(',').map(s => s.trim()).filter(Boolean)],
  DATABASE: ['database', String],
  DEBUG: ['debug', v => v === 'true' || v === '1']
}

// Tiny .env loader (KEY=value per line), existing variables win
function loadDotEnv (file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let value = m[2]
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}

// `initial` is only used to create config/server.json the first time, `overrides` always wins
function loadConfig ({ root = process.cwd(), initial = {}, overrides = {}, env = process.env, write = true } = {}) {
  const dir = path.join(root, 'config')
  const file = path.join(dir, 'server.json')
  let fileConfig = {}
  if (fs.existsSync(file)) {
    fileConfig = JSON.parse(fs.readFileSync(file, 'utf8'))
  } else if (write) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ ...DEFAULTS, ...initial }, null, 2))
  }
  const config = { ...DEFAULTS, ...fileConfig, ...overrides }
  for (const [key, [prop, parse]] of Object.entries(ENV_MAP)) {
    if (env[key] !== undefined && env[key] !== '') config[prop] = parse(env[key])
  }
  config.root = root
  config.file = file
  return config
}

// Writes the known keys back to config/server.json, keeping any extra keys the file has
function saveConfig (config) {
  let out = {}
  if (fs.existsSync(config.file)) out = JSON.parse(fs.readFileSync(config.file, 'utf8'))
  for (const key of Object.keys(DEFAULTS)) out[key] = config[key]
  fs.writeFileSync(config.file, JSON.stringify(out, null, 2))
}

module.exports = { DEFAULTS, loadConfig, saveConfig, loadDotEnv }
