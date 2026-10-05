'use strict'

// /alts: accounts that have used the same IP address (MCGalaxy's /clones)

module.exports = function alts (ctx, { findRecord }) {
  const { server } = ctx
  ctx.command({
    name: 'alts',
    category: 'moderation',
    rank: 'Operator',
    usage: '/alts <player>',
    description: 'Lists other accounts that joined from the same IP addresses',
    run (player, args, { usage }) {
      if (!args[0]) return usage()
      const record = findRecord(args[0])
      const ips = new Set(record.ips || [])
      const others = server.playerDB.all().filter(r => r.name.toLowerCase() !== record.name.toLowerCase() && (r.ips || []).some(ip => ips.has(ip)))
      if (!others.length) return player.message(`&eNo other accounts share an IP with ${record.name}.`)
      player.message(`&eAccounts sharing an IP with ${record.name}: &f${others.map(r => r.name + (r.ban ? ' &c(banned)&f' : '')).join(', ')}`)
    }
  })
}
