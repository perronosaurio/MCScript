'use strict'

// Broadcasts tips/announcements every few minutes. Edit config/plugins/announcer.json

module.exports = {
  name: 'announcer',
  version: '1.0.0',
  description: 'Periodic server announcements',
  author: 'MCScript',

  defaultConfig: {
    intervalMinutes: 5,
    prefix: '&6[Tip] &e',
    random: false,
    messages: [
      'Type &f/help&e to see all the commands you can use.',
      'Use &f/goto <level>&e to visit other worlds. &f/levels&e lists them.',
      'Protect your builds! Ask an operator to create a &f/zone&e for you.',
      'Made a mistake? &f/undo&e reverts your last changes.'
    ]
  },

  load (ctx) {
    const { server, config } = ctx
    let next = 0

    const announce = () => {
      if (!config.messages.length || !server.online.length) return
      const i = config.random ? Math.floor(Math.random() * config.messages.length) : next++ % config.messages.length
      server.broadcast(config.prefix + config.messages[i])
    }

    if (config.intervalMinutes > 0) ctx.setInterval(announce, config.intervalMinutes * 60000)

    ctx.command({
      name: 'announcer',
      category: 'server',
      rank: 'Admin',
      usage: '/announcer <add <message>|remove <number>|list|now>',
      description: 'Manages automatic announcements',
      run (player, args, { usage, raw }) {
        const sub = (args[0] || '').toLowerCase()
        if (sub === 'list') {
          config.messages.forEach((m, i) => player.message(`&f${i + 1}. &e${m}`))
          if (!config.messages.length) player.message('&eNo announcements.')
        } else if (sub === 'add') {
          const msg = raw.slice(3).trim()
          if (!msg) return usage()
          config.messages.push(ctx.text.convertPercentCodes(msg))
          ctx.saveConfig()
          player.message('&aAnnouncement added.')
        } else if (sub === 'remove') {
          const i = Number(args[1]) - 1
          if (!(i >= 0 && i < config.messages.length)) return usage()
          config.messages.splice(i, 1)
          ctx.saveConfig()
          player.message('&aAnnouncement removed.')
        } else if (sub === 'now') {
          announce()
        } else {
          return usage()
        }
      }
    })
  }
}
