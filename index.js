const { createServer } = require('./client.js')

createServer({
  'port': 25584,
  'name': 'Waxtz\'s MCScript server [Made using JavaScript]',
  'motd': 'Server made in JavaScript!',
  'max-players': 20,
  'public': true,
  'online-mode': true,
  'disable-op-command': false,
  'ops': [ 'Waxtz', 'VenkSociety' ],
  'plugins': { test: {} }
})