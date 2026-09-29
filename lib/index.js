'use strict'

const { MCScriptServer } = require('./server')
const { loadConfig, loadDotEnv } = require('./config')

// Creates and starts a server. Options are merged over config/server.json.
async function createServer ({ root = process.cwd(), initial = {}, overrides = {}, console: useConsole = false } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`MCScript needs Node.js 22.13 or newer (you have ${process.version}). Get the LTS release from https://nodejs.org`)
  }
  loadDotEnv(require('path').join(root, '.env'))
  const config = loadConfig({ root, initial, overrides })
  const server = new MCScriptServer(config)
  await server.start()
  if (useConsole) server.startConsole()
  return server
}

module.exports = {
  createServer,
  MCScriptServer,
  Blocks: require('./blocks'),
  text: require('./util/text'),
  packets: require('./protocol/packets'),
  Level: require('./level/level').Level,
  generators: require('./level/generators').generators
}
