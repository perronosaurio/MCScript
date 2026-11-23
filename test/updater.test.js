'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

const { updateBeforeStart, untar } = require('../lib/updater')

// A .tar.gz like the ones GitHub makes: a pax global header, then everything under "MCScript-<version>/"
function tarball (files) {
  const blocks = []
  const header = (name, size, type = '0', mode = 0o644) => {
    const h = Buffer.alloc(512)
    h.write(name, 0, 100)
    h.write(mode.toString(8).padStart(7, '0') + '\0', 100)
    h.write(size.toString(8).padStart(11, '0') + '\0', 124)
    h.write('00000000000\0', 136)
    h.write(type, 156)
    h.write('ustar\0', 257)
    h.write('00', 263)
    h.fill(' ', 148, 156)
    let sum = 0
    for (const b of h) sum += b
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    return h
  }
  const pad = n => Buffer.alloc((512 - (n % 512)) % 512)
  const comment = Buffer.from('52 comment=0123456789abcdef0123456789abcdef01234567\n')
  blocks.push(header('pax_global_header', comment.length, 'g'), comment, pad(comment.length))
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content)
    const full = `MCScript-9.9.9/${name}`
    if (full.length > 100) { // long names go in a pax header, as GitHub does
      const rec = ` path=${full}\n`
      let len = rec.length + 2
      if (String(len).length + rec.length !== len) len = String(len + 1).length + rec.length
      const pax = Buffer.from(`${len}${rec}`)
      blocks.push(header('PaxHeader', pax.length, 'x'), pax, pad(pax.length))
    }
    blocks.push(header(full.slice(0, 99), data.length, '0', name.endsWith('.sh') ? 0o755 : 0o644), data, pad(data.length))
  }
  blocks.push(Buffer.alloc(1024))
  return zlib.gzipSync(Buffer.concat(blocks))
}

test('autoUpdate installs a newer release and leaves the server\'s own files alone', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcscript-update-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content) }
  write('package.json', JSON.stringify({ name: 'mcscript', version: '2.2.1' }))
  write('index.js', 'old index')
  write('lib/server.js', 'old server')
  write('lib/removed.js', 'gone upstream')
  write('plugins/core-essentials/index.js', 'old essentials')
  write('plugins/my-plugin/index.js', 'mine')
  write('config/server.json', JSON.stringify({ autoUpdate: true, name: 'My server' }))
  write('levels/main.cw', 'level')
  write('data/players.json', '{}')
  write('texpacks/pack.zip', 'zip')

  const longName = `plugins/extras/${'x'.repeat(90)}.js`
  const tgz = tarball({
    'package.json': JSON.stringify({ name: 'mcscript', version: '9.9.9' }),
    'index.js': 'new index',
    'lib/server.js': 'new server',
    'plugins/core-essentials/index.js': 'new essentials',
    'plugins/extras/index.js': 'new plugin',
    [longName]: 'long',
    'test/server.test.js': 'tests are not installed',
    '.github/workflows/ci.yml': 'neither is CI',
    'scripts/start.sh': '#!/bin/sh'
  })
  assert.ok(untar(zlib.gunzipSync(tgz)).some(f => f.path.endsWith(`${'x'.repeat(90)}.js`)), 'pax long names are read')

  const asked = []
  const fetchImpl = async (url) => {
    asked.push(url)
    if (url.endsWith('/releases/latest')) return new Response(JSON.stringify({ tag_name: 'v9.9.9', html_url: 'https://example/release', draft: false, prerelease: false }))
    if (url === 'https://codeload.github.com/perronosaurio/MCScript/tar.gz/refs/tags/v9.9.9') return new Response(tgz)
    return new Response('not found', { status: 404 })
  }
  const lines = []
  const log = { info: m => lines.push(m), warn: m => lines.push(m) }
  assert.equal(await updateBeforeStart({ root, fetchImpl, log, env: {} }), '9.9.9')

  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
  assert.equal(read('index.js'), 'new index')
  assert.equal(read('lib/server.js'), 'new server')
  assert.ok(!fs.existsSync(path.join(root, 'lib/removed.js')), 'lib/ is replaced as a whole')
  assert.equal(read('plugins/core-essentials/index.js'), 'new essentials')
  assert.equal(read('plugins/extras/index.js'), 'new plugin')
  assert.equal(read(longName), 'long')
  assert.equal(read('plugins/my-plugin/index.js'), 'mine', 'your plugins stay')
  assert.equal(JSON.parse(read('config/server.json')).name, 'My server')
  assert.equal(read('levels/main.cw'), 'level')
  assert.equal(read('texpacks/pack.zip'), 'zip')
  assert.ok(!fs.existsSync(path.join(root, 'test')))
  assert.ok(!fs.existsSync(path.join(root, '.github')))
  assert.equal(fs.statSync(path.join(root, 'scripts/start.sh')).mode & 0o111, 0o111, 'scripts stay executable')
  // the old version is kept
  assert.equal(read('backups/mcscript-2.2.1/lib/server.js'), 'old server')
  assert.equal(read('backups/mcscript-2.2.1/index.js'), 'old index')
  assert.ok(!fs.existsSync(path.join(root, '.mcscript-update')))
  assert.ok(lines.some(l => /Updated to MCScript 9\.9\.9/.test(l)))

  // up to date now: nothing downloaded
  asked.length = 0
  assert.equal(await updateBeforeStart({ root, fetchImpl, log, env: {} }), null)
  assert.ok(!asked.some(u => u.includes('codeload')))
})

test('autoUpdate is off by default and never breaks the start', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcscript-update-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'mcscript', version: '2.2.1' }))
  let called = false
  const fetchImpl = async () => { called = true; throw new Error('offline') }
  const log = { info () {}, warn () {} }
  assert.equal(await updateBeforeStart({ root, fetchImpl, log, env: {} }), null)
  assert.equal(called, false)
  // on, but GitHub can't be reached: start the installed version
  const warned = []
  assert.equal(await updateBeforeStart({ root, fetchImpl, log: { info () {}, warn: m => warned.push(m) }, env: { MCSCRIPT_AUTO_UPDATE: '1' } }), null)
  assert.match(warned[0], /Could not update \(offline\)/)
  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8').includes('2.2.1'), true)
})
