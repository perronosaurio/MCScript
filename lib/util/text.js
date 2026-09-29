'use strict'

const COLORS = {
  black: '&0',
  navy: '&1',
  green: '&2',
  teal: '&3',
  maroon: '&4',
  purple: '&5',
  gold: '&6',
  silver: '&7',
  gray: '&8',
  blue: '&9',
  lime: '&a',
  aqua: '&b',
  red: '&c',
  pink: '&d',
  yellow: '&e',
  white: '&f'
}

// aliases used by older code / MCGalaxy
const ALIASES = {
  dark_blue: 'navy',
  dark_green: 'green',
  dark_red: 'maroon',
  dark_yellow: 'gold',
  grey: 'silver',
  dark_gray: 'gray',
  dark_grey: 'gray',
  indigo: 'blue',
  bright_green: 'lime',
  cyan: 'aqua'
}

const extraColorCodes = new Set()

function isColorCode (ch) {
  if (!ch) return false
  return /[0-9a-fA-F]/.test(ch) || extraColorCodes.has(ch)
}

function parseColor (name) {
  if (!name) return null
  name = String(name).toLowerCase()
  if (/^[&%][0-9a-f]$/.test(name)) return '&' + name[1]
  if (/^[0-9a-f]$/.test(name)) return '&' + name
  if (COLORS[name]) return COLORS[name]
  if (ALIASES[name]) return COLORS[ALIASES[name]]
  for (const code of extraColorCodes) if (name === code) return '&' + code
  return null
}

// Convert player typed %c codes into &c codes
function convertPercentCodes (msg) {
  return msg.replace(/%(.)/g, (m, c) => isColorCode(c) ? '&' + c.toLowerCase() : m)
}

// Remove color codes that the client can't render (a trailing & crashes old clients)
function sanitize (msg) {
  let out = ''
  for (let i = 0; i < msg.length; i++) {
    if (msg[i] === '&') {
      if (isColorCode(msg[i + 1])) { out += '&' + msg[i + 1].toLowerCase(); i++ }
      continue
    }
    out += msg[i]
  }
  return out
}

function stripColors (msg) {
  return String(msg).replace(/[&%]./g, '')
}

function lastColor (line, fallback) {
  let color = fallback
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === '&' && isColorCode(line[i + 1])) color = '&' + line[i + 1]
  }
  return color
}

// Split a message into lines of at most `max` characters, keeping colors across lines.
function wrap (message, max = 64, prefix = '> ') {
  message = sanitize(String(message))
  const lines = []
  let color = ''
  let line = ''
  const push = (l) => {
    // never end a line with a color code
    l = l.replace(/(&.)+$/, '').replace(/\s+$/, '')
    if (l.length) lines.push(l)
  }

  for (const word of message.split(' ')) {
    const candidate = line.length ? line + ' ' + word : word
    if (candidate.length <= max) { line = candidate; continue }

    if (line.length) {
      color = lastColor(line, color)
      push(line)
      // no need to repeat the color if the word sets its own
      const ownColor = word[0] === '&' && isColorCode(word[1])
      line = prefix + (color === '&f' || ownColor ? '' : color) + word
    } else {
      line = word
    }
    while (line.length > max) {
      let cut = max
      if (line[cut - 1] === '&') cut--
      const part = line.slice(0, cut)
      color = lastColor(part, color)
      push(part)
      line = prefix + (color === '&f' ? '' : color) + line.slice(cut)
    }
  }
  push(line)
  return lines
}

function formatDuration (ms) {
  const s = Math.floor(ms / 1000)
  const parts = []
  const d = Math.floor(s / 86400); if (d) parts.push(d + 'd')
  const h = Math.floor((s % 86400) / 3600); if (h) parts.push(h + 'h')
  const m = Math.floor((s % 3600) / 60); if (m) parts.push(m + 'm')
  const sec = s % 60; if (sec || !parts.length) parts.push(sec + 's')
  return parts.join(' ')
}

// "10m", "2h", "1d12h", "30" (seconds) -> milliseconds, or null
function parseDuration (str) {
  if (!str) return null
  const re = /(\d+)\s*([smhdw]?)/gi
  let total = 0
  let matched = ''
  let m
  while ((m = re.exec(str)) !== null) {
    matched += m[0]
    const n = Number(m[1])
    const unit = (m[2] || 's').toLowerCase()
    total += n * { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[unit] * 1000
  }
  if (!matched || matched.replace(/\s/g, '') !== str.replace(/\s/g, '')) return null
  return total
}

module.exports = {
  COLORS,
  extraColorCodes,
  isColorCode,
  parseColor,
  convertPercentCodes,
  sanitize,
  stripColors,
  wrap,
  formatDuration,
  parseDuration
}
