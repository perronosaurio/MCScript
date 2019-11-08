const request = require('request')

module.exports.server = (server, settings) => {
  if (settings.public === true) {
    setInterval(() => {
      server.heartbeat()
    }, 45000)
  }

  server.heartbeat = () => {
    request(
      `https://www.classicube.net/heartbeat.jsp?port=${settings.port}&max=${settings['max-players']}&name=${settings['name']}&public=true&version=7&salt=${server.salt}&users=${server['online_players']}`,
      (_error, response, body) => {
        console.log(body.errors)
        if (body.errors && body.errors[0].startsWith('Port')) console.log(`Port ${settings.port} not open, you may need to port forward it.`)
      }
    )
  }
}
