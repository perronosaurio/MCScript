const { createServer } = require('./client.js')

createServer({
  'port': 25565,
  'name': 'Waxtz\'s MCScript server [Made using JavaScript]',
  'motd': 'Server made in JavaScript!',
  'max-players': 20,
  'public': true,
  'online-mode': false,
  'disable-op-command': false,
  'ops': [ 'Waxtz', 'VenkSociety' ],
  'plugins': { test: {} }
})
