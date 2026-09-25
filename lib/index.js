'use strict'

const { MCScriptServer } = require('./server')
const { loadConfig, loadDotEnv } = require('./config')

// Creates and starts a server. Options are merged over config/server.json.
async function createServer ({ root = process.cwd(), initial = {}, overrides = {}, console: useConsole = false } = {}) {
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
