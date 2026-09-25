'use strict'

const fs = require('fs')
const path = require('path')

// Small JSON file store with debounced, atomic writes.
class JsonStore {
  constructor (file, defaults = {}) {
    this.file = file
    this.data = defaults
    this.timer = null
    if (fs.existsSync(file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch (err) {
        // keep a copy of the broken file instead of losing it
        fs.copyFileSync(file, `${file}.broken-${Date.now()}`)
      }
    }
  }

  save () {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 1000)
    if (this.timer.unref) this.timer.unref()
  }

  flush () {
    clearTimeout(this.timer)
    this.timer = null
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    fs.renameSync(tmp, this.file)
  }
}

module.exports = { JsonStore }
