'use strict'

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const MAX_SIZE = 2 * 1024 * 1024
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
// "package", "@scope/package", optionally with "@version" or "@tag"
const NPM_SPEC_RE = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(@[A-Za-z0-9._~^<>=*|+-]+)?$/

// GitHub page URLs -> raw file URLs
function rawUrl (url) {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`
  const g = url.match(/^https:\/\/gist\.github\.com\/([^/]+)\/([0-9a-f]+)\/?$/)
  if (g) return `https://gist.githubusercontent.com/${g[1]}/${g[2]}/raw`
  return url
}

// Reads a response body, giving up as soon as it goes over `max` bytes
async function readLimited (res, max) {
  if (!res.body || !res.body.getReader) {
    const text = await res.text()
    if (Buffer.byteLength(text) > max) throw new Error('The file is too big (max 2 MB)')
    return text
  }
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      reader.cancel().catch(() => {})
      throw new Error('The file is too big (max 2 MB)')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks).toString('utf8')
}

// Downloads a single-file plugin into plugins/<name>.js. Returns the plugin name.
async function installFromUrl (pluginsDir, url, { fetchImpl = fetch } = {}) {
  // plain http would let anyone on the network path swap the code (fine for this machine only)
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(url)) {
    throw new Error('The URL must start with https://')
  }
  const src = rawUrl(url)
  const res = await fetchImpl(src, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const len = Number(res.headers.get('content-length') || 0)
  if (len > MAX_SIZE) throw new Error('The file is too big (max 2 MB)')
  const code = await readLimited(res, MAX_SIZE)
  if (!/module\.exports|exports\./.test(code)) throw new Error('That does not look like a MCScript plugin (no module.exports)')

  const declared = code.match(/name\s*:\s*['"]([A-Za-z0-9_.-]+)['"]/)
  const fromUrl = path.basename(new URL(src).pathname).replace(/\.js$/i, '')
  const name = declared ? declared[1] : fromUrl
  if (!NAME_RE.test(name)) throw new Error(`Invalid plugin name "${name}"`)
  const file = path.join(pluginsDir, `${name}.js`)
  if (fs.existsSync(file) || fs.existsSync(path.join(pluginsDir, name))) throw new Error(`A plugin named ${name} is already installed (use /puninstall first)`)
  fs.mkdirSync(pluginsDir, { recursive: true })
  fs.writeFileSync(file, code)
  return name
}

// Installs an npm package as plugins/<name>/ (with its own node_modules). Lifecycle scripts are not run.
function installFromNpm (pluginsDir, spec, { npm = process.platform === 'win32' ? 'npm.cmd' : 'npm' } = {}) {
  return new Promise((resolve, reject) => {
    // the spec ends up on the npm command line, so only accept plain package names (or file: paths)
    if (spec.startsWith('file:') ? /[\s"'`$&|;<>^%]/.test(spec) : !NPM_SPEC_RE.test(spec)) {
      return reject(new Error(`Invalid package "${spec}"`))
    }
    const pkgName = spec.startsWith('file:') ? null : spec.replace(/^(@[^/]+\/[^@]+|[^@]+).*$/, '$1')
    let name = pkgName ? pkgName.replace(/^@/, '').replace(/\//g, '-') : path.basename(spec.slice(5))
    name = name.replace(/^mcscript-plugin-/, '')
    if (!NAME_RE.test(name)) return reject(new Error(`Invalid package name "${spec}"`))
    const dir = path.join(pluginsDir, name)
    if (fs.existsSync(dir) || fs.existsSync(dir + '.js')) return reject(new Error(`A plugin named ${name} is already installed (use /puninstall first)`))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `mcscript-plugin-wrapper-${name}`, private: true }, null, 2))

    const args = ['install', spec, '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', '--prefix', dir]
    execFile(npm, args, { timeout: 180000, shell: process.platform === 'win32' }, (err, stdout, stderr) => {
      if (err) {
        fs.rmSync(dir, { recursive: true, force: true })
        return reject(new Error(`npm install failed: ${(stderr || err.message).trim().split('\n').pop()}`))
      }
      // find the installed package name (for file: specs we read it from package.json)
      const deps = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies || {}
      const installed = Object.keys(deps)[0]
      fs.writeFileSync(path.join(dir, 'index.js'), `'use strict'\n\n// Installed with /pinstall npm:${spec}\nmodule.exports = require(${JSON.stringify(installed)})\n`)
      // use the name the plugin declares for its folder, so /plugins and /punload agree
      let declared = null
      try {
        const main = require.resolve(installed, { paths: [dir] })
        const m = fs.readFileSync(main, 'utf8').match(/name\s*:\s*['"]([A-Za-z0-9_.-]+)['"]/)
        if (m) declared = m[1]
      } catch (e) {}
      if (declared && declared !== name && NAME_RE.test(declared) && !fs.existsSync(path.join(pluginsDir, declared)) && !fs.existsSync(path.join(pluginsDir, declared + '.js'))) {
        fs.renameSync(dir, path.join(pluginsDir, declared))
        name = declared
      }
      resolve(name)
    })
  })
}

// Moves a plugin out of the plugins folder (to plugins/.removed) instead of deleting it
function uninstall (pluginsDir, name) {
  if (!NAME_RE.test(name)) throw new Error(`Invalid plugin name "${name}"`)
  const candidates = [path.join(pluginsDir, name), path.join(pluginsDir, `${name}.js`)]
  const target = candidates.find(p => fs.existsSync(p))
  if (!target) throw new Error(`Plugin ${name} is not installed`)
  const removed = path.join(pluginsDir, '.removed')
  fs.mkdirSync(removed, { recursive: true })
  const dest = path.join(removed, `${path.basename(target)}-${Date.now()}`)
  fs.renameSync(target, dest)
  return dest
}

module.exports = { installFromUrl, installFromNpm, uninstall, rawUrl }
