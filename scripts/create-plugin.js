'use strict'

// Usage: npm run plugin:create <name> [author]
const fs = require('fs')
const path = require('path')
const template = require('../lib/plugins/template')

const [name, author] = process.argv.slice(2)
if (!name || !/^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(name)) {
  console.error('Usage: npm run plugin:create <name> [author]')
  process.exit(1)
}
const dir = path.join(__dirname, '..', 'plugins', name)
if (fs.existsSync(dir)) {
  console.error(`plugins/${name} already exists`)
  process.exit(1)
}
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'index.js'), template(name, author))
console.log(`Created plugins/${name}/index.js`)
console.log('Start the server (or use /pload ' + name + ' in-game) to load it.')
