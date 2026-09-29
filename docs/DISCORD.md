# Discord bot

The `relay-discord` plugin connects the server to a Discord server, the same way MCGalaxy's Discord bot does:

- **Chat channels.** In-game chat, joins and leaves are posted there, and whatever people write there shows up
  in the game as `[Discord] name: message`.
- **Staff channels.** Linked to the in-game staff chat: `/opchat` and `#message` from the game go there, and
  messages written there reach operators in the game.
- **Commands.** `!command args` runs a server command from any of those channels, and the output comes back
  as a message. `!players` (also `.who` and `.players`, as in MCGalaxy) lists who is online.

## 1. Create the bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Open **Bot**. Click **Reset Token** and copy the token; this is `botToken`. Keep it secret: anyone with it
   controls the bot.
3. On the same page, under **Privileged Gateway Intents**, turn on **Message Content Intent** and save. Without
   it the bot can't read messages and the console says so.
4. Open **OAuth2 → URL Generator**, tick the `bot` scope and these permissions: *View Channels*,
   *Send Messages* and *Read Message History*. Open the generated link and add the bot to your Discord server.

## 2. Get the IDs

In Discord, open **User Settings → Advanced** and turn on **Developer Mode**. Now you can right-click a
channel, a role or a user and choose **Copy ID**.

## 3. Configure the plugin

Edit `config/plugins/relay-discord.json` (it is created the first time the server starts):

```json
{
  "enabled": true,
  "botToken": "paste the token here",
  "chatChannelIds": ["123456789012345678"],
  "staffChannelIds": ["234567890123456789"],
  "roleRanks": {
    "345678901234567890": "Operator",
    "456789012345678901": "Admin"
  },
  "inviteUrl": "https://discord.gg/yourinvite"
}
```

Then run `/preload relay-discord` (or restart). The console shows `Connected to Discord as ...` when it works.

| Setting | Default | What it does |
| --- | --- | --- |
| `enabled` | `false` | Turns the bot on |
| `botToken` | | The bot token from the Developer Portal |
| `chatChannelIds` | `[]` | Channels linked to the public chat |
| `staffChannelIds` | `[]` | Channels linked to the staff chat (operators and up) |
| `commandPrefix` | `!` | What commands start with |
| `publicCommands` | players, serverinfo, rules, levels, whois, top, baltop, faq, news | Commands anyone can use from a chat or staff channel |
| `staffRank` | `Operator` | Rank used for commands typed in a staff channel |
| `roleRanks` | `{}` | Discord role ID → server rank. Members with that role can use that rank's commands from any linked channel |
| `userRanks` | `{}` | Discord user ID → server rank, for single people (the owner, for example) |
| `bannedCommands` | pinstall, puninstall, pcreate | Commands that can never be run from Discord |
| `ignoredUserIds` | `[]` | Discord users whose messages are ignored |
| `useNicknames` | `true` | Show server nicknames instead of Discord usernames |
| `relayJoins` | `true` | Post joins and leaves |
| `relayStaffChat` | `true` | Post the in-game staff chat to the staff channels |
| `status` | `with {players}/{max} players` | The bot's "Playing ..." status. Empty to turn it off |
| `inviteUrl` | | Adds `/discord`, which shows this link in the game |
| `discordPrefix` | `&9[Discord] ` | How Discord messages are shown in the game |
| `webhookUrl` | | Sends chat through a webhook instead of a bot (one way only, no commands) |

## Who can run what

A command from Discord runs with a server rank, exactly as if a player with that rank typed it in the game:

1. The highest rank from `userRanks` and `roleRanks` for that person.
2. In a staff channel, at least `staffRank`. Make sure only staff can read and write in that channel.
3. Anyone else can only use `publicCommands`, with the default rank.

Rank rules still apply, so an Operator on Discord can't give someone Admin or `/sudo` an Owner. Commands that
need to be in the game (`/tp`, `/cuboid`...) answer that they can only be used in-game. Every command run from
Discord is written to the server log with the name of the person who ran it.

## Examples

```
!players                 who is online
!rules                   the server rules
!kick Griefer spamming   kick a player (needs Operator)
!ban Griefer 1d grief    one-day ban
!mute Loud 10m           ten-minute mute
!say Restart in 5 min    announce in the game
!save all                save every level
```

## Troubleshooting

- **"the Message Content intent is not enabled"**: turn it on in the Developer Portal (step 1.3) and
  `/preload relay-discord`.
- **"the bot token is wrong"**: copy the token again (Reset Token gives you a new one).
- **Nothing is posted**: check that the bot can see the channel and send messages there, and that the IDs
  are channel IDs (not server IDs).
- **Commands answer "You don't have permission"**: the person needs a role listed in `roleRanks`, or has to
  write in a staff channel.
