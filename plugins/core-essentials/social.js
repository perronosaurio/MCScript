'use strict'

// /vote /timer /pronouns /quit, as in MCGalaxy

module.exports = function social (ctx) {
  const { server, CommandError, text } = ctx
  const isOp = p => p.permission >= server.ranks.permissionOf('Operator')

  // a yes/no vote everyone online can answer with /yes or /no (or by typing yes/no in chat)
  let vote = null
  const finishVote = () => {
    if (!vote) return
    const { question, yes, no } = vote
    vote = null
    server.broadcast(`&eVote over: &f${question} &a${yes.size} yes &7- &c${no.size} no`)
  }
  const answer = (player, choice) => {
    if (!vote) throw new CommandError('There is no vote going on.')
    const key = player.name.toLowerCase()
    vote.yes.delete(key); vote.no.delete(key)
    vote[choice].add(key)
    player.message(`&eYou voted &f${choice}&e.`)
  }
  ctx.command({
    name: 'vote',
    category: 'chat',
    rank: 'Operator',
    usage: '/vote <question> | /vote end',
    description: 'Asks everyone a yes/no question for 30 seconds',
    run (player, args, { usage }) {
      if (!args.length) return usage()
      if (args[0].toLowerCase() === 'end') { if (!vote) throw new CommandError('There is no vote going on.'); return finishVote() }
      if (vote) throw new CommandError('A vote is already going on. /vote end stops it.')
      const question = text.sanitize(args.join(' '))
      vote = { question, yes: new Set(), no: new Set(), timer: ctx.setTimeout(finishVote, 30000) }
      server.broadcast(`&eVote by ${player.coloredName}&e: &f${question}`)
      server.broadcast('&eAnswer with &a/yes&e or &c/no&e (30 seconds).')
    }
  })
  ctx.command({ name: 'yes', category: 'chat', usage: '/yes', description: 'Votes yes', run (p) { answer(p, 'yes') } })
  ctx.command({ name: 'no', category: 'chat', usage: '/no', description: 'Votes no', run (p) { answer(p, 'no') } })

  // countdown shown in the middle of everyone's screen
  let countdown = null
  ctx.command({
    name: 'timer',
    category: 'chat',
    rank: 'Operator',
    usage: '/timer <seconds> [message] | /timer stop',
    description: 'Counts down on everyone\'s screen',
    run (player, args, { usage }) {
      if ((args[0] || '').toLowerCase() === 'stop') {
        if (!countdown) throw new CommandError('No timer is running.')
        ctx.clearTimer(countdown); countdown = null
        return server.broadcast('&eTimer stopped.', null, 'announce')
      }
      const seconds = Number(args[0])
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) return usage()
      if (countdown) ctx.clearTimer(countdown)
      const label = text.sanitize(args.slice(1).join(' ')) || 'Time left'
      let left = seconds
      const tick = () => {
        if (left <= 0) {
          ctx.clearTimer(countdown); countdown = null
          return server.broadcast(`&e${label}: &cTime's up!`, null, 'announce')
        }
        if (left <= 10 || left % 10 === 0 || left === seconds) server.broadcast(`&e${label}: &f${text.formatDuration(left * 1000)}`, null, 'announce')
        left--
      }
      tick()
      countdown = ctx.setInterval(tick, 1000)
    }
  })

  ctx.command({
    name: 'pronouns',
    category: 'essentials',
    usage: '/pronouns <pronouns|clear> [player]',
    description: 'Sets the pronouns shown in /whois, like they/them',
    run (player, args, { usage }) {
      if (!args.length) return usage()
      let record = player.record
      if (args[1]) {
        if (!isOp(player)) throw new CommandError('Only operators can set other people\'s pronouns.')
        record = server.playerDB.find(args[1])
        if (!record) throw new CommandError('Player not found.')
      }
      if (!record) throw new CommandError('Give a player name.')
      const value = args[0].toLowerCase() === 'clear' ? null : text.stripColors(args[0]).slice(0, 24)
      if (value && !/^[A-Za-z]+(\/[A-Za-z]+){0,3}$/.test(value)) throw new CommandError('Use something like she/her, he/him, they/them or any/all.')
      record.pronouns = value
      server.playerDB.save()
      player.message(value ? `&ePronouns set to &f${value}&e.` : '&ePronouns cleared.')
    }
  })

  const leave = (player, reason) => player.kick(reason)
  ctx.command({
    name: 'quit',
    category: 'essentials',
    usage: '/quit [message]',
    description: 'Leaves the server with a message',
    inGame: true,
    run (player, args) { leave(player, text.stripColors(args.join(' ')).slice(0, 60) || 'Left the game') }
  })
  ctx.command({
    name: 'ragequit',
    aliases: ['rq'],
    category: 'essentials',
    usage: '/ragequit',
    description: 'Leaves the server in a hurry',
    inGame: true,
    run (player) {
      server.broadcast(`${player.coloredName} &cragequit!`)
      leave(player, 'RAGEQUIT!!')
    }
  })

  return { pronounsOf: record => (record && record.pronouns) || null }
}
