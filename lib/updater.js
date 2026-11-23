'use strict'

// Automatic updates. With "autoUpdate": true in config/server.json, the server checks GitHub for a newer
// MCScript release before it starts, and installs it: MCScript's own files are replaced (lib/, the bundled
// plugins, docs/, index.js...) and nothing of yours is touched (config/, levels/, data/, texpacks/, plugins
// you added). The previous version is kept in backups/mcscript-<version>/ in case you need to go back.
// While running, a newer release is installed by restarting as soon as nobody is online.
//
// This file must only use Node's own modules: it runs before the rest of MCScript is loaded.

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const REPO = 'perronosaurio/MCScript'
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const TARBALL_URL = tag => `https://codeload.github.com/${REPO}/tar.gz/refs/tags/${encodeURIComponent(tag)}`

// What an update may write. Anything else in the release (tests, CI files) is left out.
const FILES = ['index.js', 'package.json', 'package-lock.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'SECURITY.md',
  'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', '.env.example']
const DIRS = ['lib', 'docs', 'scripts'] // replaced as a whole, so files removed upstream go away too
// plugins/<name>/ is replaced for each plugin that ships with MCScript; your own plugins stay

// "2.1.0" > "2.0.3"; pre-releases ("2.1.0-beta.1") count as older than the final release.
// (A copy of update-check's: this file must not load other MCScript files, they may be about to change.)
function isNewer (latest, current) {
  const parse = v => {
    const [main, pre] = String(v).replace(/^v/, '').split('-')
    return { nums: main.split('.').map(n => parseInt(n, 10) || 0), pre: pre || null }
  }
  const a = parse(latest)
  const b = parse(current)
  for (let i = 0; i < 3; i++) {
    if ((a.nums[i] || 0) !== (b.nums[i] || 0)) return (a.nums[i] || 0) > (b.nums[i] || 0)
  }
  if (a.pre === b.pre) return false
  if (!a.pre) return true
  if (!b.pre) return false
  return a.pre > b.pre
}

function readJson (file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (err) { return fallback }
}

function currentVersion (root) {
  return readJson(path.join(root, 'package.json'), {}).version || '0.0.0'
}

// Minimal tar reader (ustar, with the pax and GNU long name extensions GitHub's tarballs use)
function untar (buf) {
  const files = []
  const str = (b, start, len) => {
    const s = b.subarray(start, start + len)
    const end = s.indexOf(0)
    return s.subarray(0, end === -1 ? s.length : end).toString('utf8')
  }
  let off = 0
  let longName = null
  let paxPath = null
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512)
    if (h.every(b => b === 0)) break
    const name = str(h, 0, 100)
    const mode = parseInt(str(h, 100, 8).trim() || '644', 8)
    const size = parseInt(str(h, 124, 12).trim() || '0', 8)
    const type = h[156] === 0 ? '0' : String.fromCharCode(h[156])
    const prefix = h.subarray(257, 262).toString() === 'ustar' ? str(h, 345, 155) : ''
    const data = buf.subarray(off + 512, off + 512 + size)
    off += 512 + Math.ceil(size / 512) * 512
    if (type === 'x') { // pax header for the next file
      const m = data.toString('utf8').match(/\d+ path=([^\n]*)\n/)
      if (m) paxPath = m[1]
      continue
    }
    if (type === 'g') continue // pax global header (GitHub puts the commit id there)
    if (type === 'L') { longName = str(data, 0, size); continue }
    const full = paxPath || longName || (prefix ? `${prefix}/${name}` : name)
    paxPath = null
    longName = null
    if (type === '0' || type === '7') files.push({ path: full, mode, data: Buffer.from(data) })
  }
  return files
}

// Keeps the files an update may write, with the release's top folder ("MCScript-2.3.0/") removed
function pickFiles (entries) {
  const out = []
  for (const e of entries) {
    const rel = e.path.split('/').slice(1).join('/')
    if (!rel || rel.split('/').some(part => part === '..' || part === '') || path.isAbsolute(rel)) continue
    const top = rel.split('/')[0]
    const ok = FILES.includes(rel) || DIRS.includes(top) || (top === 'plugins' && rel.split('/').length >= 3)
    if (ok) out.push({ ...e, rel })
  }
  return out
}

function copyInto (src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
}

// Writes the new files. Everything is written to a staging folder first, so a failure halfway leaves the
// installed version as it was.
function install (root, files, version) {
  const staging = path.join(root, '.mcscript-update')
  fs.rmSync(staging, { recursive: true, force: true })
  for (const f of files) {
    const dest = path.join(staging, f.rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, f.data, { mode: f.mode & 0o777 })
  }
  // what gets replaced: top files, whole folders, and each bundled plugin's folder
  const targets = new Set()
  for (const f of files) {
    const parts = f.rel.split('/')
    if (parts[0] === 'plugins') targets.add(`plugins/${parts[1]}`)
    else if (DIRS.includes(parts[0])) targets.add(parts[0])
    else targets.add(f.rel)
  }
  // keep the version being replaced
  const backup = path.join(root, 'backups', `mcscript-${version}`)
  fs.rmSync(backup, { recursive: true, force: true })
  fs.mkdirSync(backup, { recursive: true })
  for (const t of targets) {
    const current = path.join(root, t)
    if (fs.existsSync(current)) copyInto(current, path.join(backup, t))
  }
  // keep only the latest backup of MCScript itself
  for (const old of fs.readdirSync(path.join(root, 'backups'))) {
    if (old.startsWith('mcscript-') && old !== `mcscript-${version}`) fs.rmSync(path.join(root, 'backups', old), { recursive: true, force: true })
  }
  for (const t of targets) {
    const current = path.join(root, t)
    fs.rmSync(current, { recursive: true, force: true })
    copyInto(path.join(staging, t), current)
  }
  fs.rmSync(staging, { recursive: true, force: true })
  return [...targets]
}

// Looks for a newer release. Returns { version, tag, url } or null.
async function findUpdate (current, { fetchImpl = globalThis.fetch, url = RELEASES_URL } = {}) {
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `MCScript/${current}` },
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  const release = await res.json()
  const tag = String(release.tag_name || '')
  const version = tag.replace(/^v/, '')
  if (!version || release.draft || release.prerelease || !isNewer(version, current)) return null
  return { version, tag, url: release.html_url }
}

// Downloads and installs a release. Returns the list of replaced paths.
async function downloadAndInstall (root, update, { fetchImpl = globalThis.fetch, tarballUrl = TARBALL_URL } = {}) {
  const res = await fetchImpl(tarballUrl(update.tag), { headers: { 'User-Agent': 'MCScript' }, signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`download failed (${res.status})`)
  const tar = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()))
  const files = pickFiles(untar(tar))
  if (!files.some(f => f.rel === 'package.json') || !files.some(f => f.rel === 'lib/server.js')) {
    throw new Error('the download does not look like an MCScript release')
  }
  const pkg = JSON.parse(files.find(f => f.rel === 'package.json').data.toString('utf8'))
  if (!/mcscript/i.test(pkg.name || '')) throw new Error('the download does not look like an MCScript release')
  return install(root, files, currentVersion(root))
}

// Run before MCScript is loaded. Never throws: a failed update just starts the installed version.
async function updateBeforeStart ({ root = process.cwd(), log = console, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const cfg = readJson(path.join(root, 'config', 'server.json'), {})
  const wanted = env.MCSCRIPT_AUTO_UPDATE !== undefined ? /^(1|true|yes|on)$/i.test(env.MCSCRIPT_AUTO_UPDATE) : cfg.autoUpdate === true
  if (!wanted || typeof fetchImpl !== 'function') return null
  // a git checkout updates with git pull, not like this
  if (fs.existsSync(path.join(root, '.git'))) {
    log.info('[updater] This is a git checkout: update it with git pull (autoUpdate skipped).')
    return null
  }
  const current = currentVersion(root)
  try {
    const update = await findUpdate(current, { fetchImpl })
    if (!update) return null
    log.info(`[updater] Installing MCScript ${update.version} (you have ${current})...`)
    await downloadAndInstall(root, update, { fetchImpl })
    log.info(`[updater] Updated to MCScript ${update.version}. The old version is in backups/mcscript-${current}/. Release notes: ${update.url}`)
    return update.version
  } catch (err) {
    log.warn(`[updater] Could not update (${err.message}); starting the installed version.`)
    return null
  }
}

module.exports = { updateBeforeStart, findUpdate, downloadAndInstall, untar, pickFiles, install, currentVersion }
