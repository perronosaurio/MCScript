'use strict'

const { createServer } = require('./lib')

// Values used only the first time, to create config/server.json.
// After that, edit config/server.json (or use environment variables / .env).
const initial = {
  name: 'Waxtz\'s freebuild [Made using JavaScript]',
  motd: 'Server made in JavaScript!',
  maxPlayers: 20,
  public: true,
  verifyNames: true,
  owners: ['Waxtz', 'VenkSociety']
}

createServer({ initial, console: true }).then(server => {
  const shutdown = () => server.stop().then(() => process.exit(0))
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}).catch(err => {
  console.error('Failed to start the server:', err)
  process.exit(1)
})
