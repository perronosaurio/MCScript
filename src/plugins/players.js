module.exports.server = (server) => {
  server.players = []
  server.entityID = 0

  server.getPlayer = (name) => {
    const found = server.players.filter((pl) => {
      return pl.name === name
    })

    if (found.length > 0) return found[0]
    return null
  }
}
