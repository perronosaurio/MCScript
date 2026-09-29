'use strict'

const fs = require('fs')
const path = require('path')
const { stripColors } = require('./text')

// &x color code -> ANSI escape for the console
const ANSI = {
  0: '\x1b[30m',
  1: '\x1b[34m',
  2: '\x1b[32m',
  3: '\x1b[36m',
  4: '\x1b[31m',
  5: '\x1b[35m',
  6: '\x1b[33m',
  7: '\x1b[37m',
  8: '\x1b[90m',
  9: '\x1b[94m',
  a: '\x1b[92m',
  b: '\x1b[96m',
  c: '\x1b[91m',
  d: '\x1b[95m',
  e: '\x1b[93m',
  f: '\x1b[97m'
}
const RESET = '\x1b[0m'
const LEVEL_COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' }

function toAnsi (msg) {
  return String(msg).replace(/&([0-9a-f])/gi, (m, c) => ANSI[c.toLowerCase()] || '') + RESET
}

class Logger {
  constructor (opts = {}) {
    this.dir = opts.dir || null
    this.useColors = opts.colors !== undefined ? opts.colors : process.stdout.isTTY
    this.silent = !!opts.silent
    this.debugEnabled = !!opts.debug
    this.prefix = opts.prefix || ''
    this.shared = { stream: null, date: null, listeners: new Set() }
  }

  child (prefix) {
    const c = Object.create(this)
    c.prefix = this.prefix + `[${prefix}] `
    return c
  }

  _file () {
    if (!this.dir) return null
    const shared = this.shared
    const date = new Date().toISOString().slice(0, 10)
    if (shared.date !== date) {
      if (shared.stream) shared.stream.end()
      fs.mkdirSync(this.dir, { recursive: true })
      shared.stream = fs.createWriteStream(path.join(this.dir, `${date}.log`), { flags: 'a' })
      shared.stream.on('error', () => {})
      shared.date = date
    }
    return shared.stream
  }

  log (level, ...args) {
    if (level === 'debug' && !this.debugEnabled) return
    const msg = args.map(a => a instanceof Error ? (a.stack || a.message) : typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
    const time = new Date().toTimeString().slice(0, 8)
    const plain = `${time} [${level.toUpperCase()}] ${this.prefix}${stripColors(msg)}`
    const file = this._file()
    if (file) file.write(plain + '\n')
    for (const fn of this.shared.listeners) {
      try { fn({ time: Date.now(), level, message: this.prefix + msg }) } catch (err) {}
    }
    if (this.silent) return
    const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout
    if (this.useColors) {
      out.write(`\x1b[90m${time}${RESET} ${LEVEL_COLORS[level]}${level.toUpperCase()}${RESET} ${this.prefix}${toAnsi('&f' + msg)}\n`)
    } else {
      out.write(plain + '\n')
    }
  }

  // Receives every log line ({ time, level, message }); returns a function to stop
  subscribe (fn) {
    this.shared.listeners.add(fn)
    return () => this.shared.listeners.delete(fn)
  }

  debug (...a) { this.log('debug', ...a) }
  info (...a) { this.log('info', ...a) }
  warn (...a) { this.log('warn', ...a) }
  error (...a) { this.log('error', ...a) }

  close () { if (this.shared.stream) this.shared.stream.end() }
}

module.exports = { Logger }
