const irc = require('irc')

module.exports.server = (server) => {
  this.irc = new irc.Client('irc.snoonet.org', 'MCScript', {
    channels: ['#snoonet'],
    password: 'sonic',
    secure: false
  })

  this.irc.nick = 'MCScript'
  this.irc._updateMaxLineLength()
  this.irc.addListener('message', (from, to, message) => server.broadcast(`[irc] <${from}> ${message}`))
  this.irc.addListener('error', message => console.log('error: ', message))
}

module.exports.player = (player, server) => {
  this.irc.join('##taigacult sonic')

  const ircSay = (message) => this.irc.say('##taigacult', `[mc] ${message}`)
  player.on('chat', ({ message }) => ircSay(`${player.username}: ${message}`))
  player.on('connected', () => ircSay(`${player.username} connected`))
  player.on('disconnected', () => ircSay(`${player.username} disconnected`))
}
