const { createServer } = require('./client.js')

createServer({
  'port': process.env.PORT,
  'name': 'Waxtz\'s freebuild [Made using JavaScript]',
  'motd': 'Server made in JavaScript!',
  'max-players': 20,
  'public': true,
  'online-mode': process.env.ONLINE_MODE,
  'disable-op-command': false,
  'ops': [ 'Waxtz', 'VenkSociety' ],
  'plugins': { test: {} }
})
