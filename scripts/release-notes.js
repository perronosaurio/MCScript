'use strict'

// Prints the CHANGELOG.md section for one version (used by the release workflow).
// Usage: node scripts/release-notes.js 2.0.0
const fs = require('fs')
const path = require('path')

const version = process.argv[2]
if (!version) {
  console.error('Usage: node scripts/release-notes.js <version>')
  process.exit(1)
}
const lines = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8').split(/\r?\n/)
const start = lines.findIndex(l => l.startsWith(`## ${version}`))
if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}`)
  process.exit(1)
}
let end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
if (end === -1) end = lines.length
console.log(lines.slice(start + 1, end).join('\n').trim())
