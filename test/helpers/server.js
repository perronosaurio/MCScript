'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { MCScriptServer } = require('../../lib/server')
const { loadConfig } = require('../../lib/config')

const REPO = path.join(__dirname, '..', '..')

// Starts a server in a temporary folder with a copy of the bundled plugins.
async function startServer (overrides = {}, root = null, pluginConfigs = {}) {
  if (!root) {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcscript-test-'))
    fs.cpSync(path.join(REPO, 'plugins'), path.join(root, 'plugins'), {
      recursive: true,
      filter: src => !src.endsWith('test.js')
    })
  }
  for (const [name, cfg] of Object.entries(pluginConfigs)) {
    fs.mkdirSync(path.join(root, 'config', 'plugins'), { recursive: true })
    fs.writeFileSync(path.join(root, 'config', 'plugins', `${name}.json`), JSON.stringify(cfg))
  }
  const config = loadConfig({
    root,
    env: {},
    overrides: {
      port: 0,
      host: '127.0.0.1',
      public: false,
      verifyNames: false,
      silent: true,
      logToFile: false,
      autosaveMinutes: 0,
      backupMinutes: 0,
      exitOnStop: false,
      mainLevel: 'main',
      ...overrides
    }
  })
  const server = new MCScriptServer(config)
  // small main level so tests run fast
  if (!fs.existsSync(path.join(root, 'levels', 'main.cw'))) {
    fs.mkdirSync(path.join(root, 'levels'), { recursive: true })
    const { Level } = require('../../lib/level/level')
    const { generators } = require('../../lib/level/generators')
    const level = new Level({ name: 'main', width: 64, height: 32, length: 64 })
    generators.flat.generate(level)
    fs.writeFileSync(path.join(root, 'levels', 'main.cw'), level.toCW())
  }
  await server.start()
  return { server, root }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = { startServer, sleep }
