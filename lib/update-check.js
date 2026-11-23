'use strict'

// Asks GitHub for the latest MCScript release and logs a line when a newer one is out.
// Turn it off with "checkForUpdates": false in config/server.json.

const RELEASES_URL = 'https://api.github.com/repos/perronosaurio/MCScript/releases/latest'

// "2.1.0" > "2.0.3"; pre-releases ("2.1.0-beta.1") count as older than the final release
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

async function checkForUpdates (server, { url = RELEASES_URL, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `MCScript/${server.version}` },
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) return null
    const release = await res.json()
    const latest = String(release.tag_name || '').replace(/^v/, '')
    if (latest && isNewer(latest, server.version)) {
      server.log.info(`&eMCScript ${latest} is out (you have ${server.version}): &b${release.html_url}`)
      return latest
    }
  } catch (err) {
    server.log.debug(`Update check failed: ${err.message}`)
  }
  return null
}

// With "autoUpdate": true, looks for a new release every few hours while running. When there is one, the
// server restarts as soon as nobody is online, and the update is installed while it starts (lib/updater.js).
function watchForUpdates (server, { everyHours = 6, fetchImpl = fetch } = {}) {
  const { findUpdate } = require('./updater')
  let pending = null
  const check = async () => {
    if (pending || !server.running) return
    try {
      pending = await findUpdate(server.version, { fetchImpl })
    } catch (err) {
      server.log.debug(`Update check failed: ${err.message}`)
    }
    if (!pending) return
    server.log.info(`&eMCScript ${pending.version} is out. It will be installed when nobody is online (or with /update now).`)
    for (const p of server.online) {
      if (p.permission >= server.ranks.permissionOf('Admin')) p.message(`&eMCScript ${pending.version} is out. The server installs it when it is empty, or now with &f/update now&e.`)
    }
  }
  const timers = [
    setInterval(check, everyHours * 3600000),
    setInterval(() => {
      if (!pending || !server.running || server.online.length) return
      server.commands.execute(server.console, `/restart Installing MCScript ${pending.version}`)
    }, 60000)
  ]
  for (const t of timers) t.unref()
  server.events.on('serverStop', () => timers.forEach(clearInterval))
  check()
  return { check, get pending () { return pending } }
}

module.exports = { checkForUpdates, watchForUpdates, isNewer }
