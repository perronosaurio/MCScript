const { createServer } = require('./')

createServer({
  'port': 443,
  'name': 'MCScript',
  'motd': 'Server made in JavaScript!',
  'max-players': 20,
  'public': true,
  'online-mode': false,
  'disable-op-command': false,
  'ops': [ 'Waxtz' ],
  'plugins': { test: {} }
})

console.log(process.env.PORT)
