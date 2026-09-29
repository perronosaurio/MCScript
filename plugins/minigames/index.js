'use strict'

// Minigames: Parkour, TNT Wars, Capture the Flag and Zombie Survival.
// An operator turns a level into an arena (/tntwars enable, /ctf enable, /zombie enable or the
// /parkour set... commands) and players join with /<game> join.

module.exports = {
  name: 'minigames',
  version: '1.0.0',
  description: 'Parkour, TNT Wars, Capture the Flag and Zombie Survival',
  author: 'MCScript',

  defaultConfig: {
    reward: 50, // coins for the winners (needs the economy plugin)
    parkourReward: 25,
    tntwars: { scoreLimit: 10, radius: 3, timeLimitMinutes: 10 },
    ctf: { captures: 3, timeLimitMinutes: 10, tagDistance: 4 },
    zombie: { minutes: 5, touchDistance: 1.2 }
  },

  load (ctx) {
    require('./parkour')(ctx)
    const games = {
      tntwars: require('./tntwars')(ctx),
      ctf: require('./ctf')(ctx),
      zombie: require('./zombie')(ctx)
    }
    module.exports.api = { games }
  }
}
