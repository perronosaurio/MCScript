'use strict'

const { createServer } = require('./lib')

// Values used only the first time, to create config/server.json.
// After that, edit config/server.json (or use environment variables / .env).
const initial = {
  name: 'MCScript Server',
  motd: 'Welcome! Server made in JavaScript',
  maxPlayers: 20,
  public: false,
  verifyNames: true,
  owners: []
}

createServer({ initial, console: true }).then(server => {
  const shutdown = () => server.stop().then(() => process.exit(0))
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  // a forgotten await in a plugin should be logged, not crash the server
  process.on('unhandledRejection', err => server.log.error('Unhandled promise rejection:', err))
}).catch(err => {
  console.error('Failed to start the server:', err)
  process.exit(1)
})
