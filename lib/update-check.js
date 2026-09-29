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

module.exports = { checkForUpdates, isNewer }
