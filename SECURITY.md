# Security

## Reporting a problem

Please don't open a public issue for security problems. Use GitHub's private vulnerability reporting instead
("Report a vulnerability" under the Security tab of this repository), and include:

- what an attacker can do and what they need (a normal game client, a rank, access to the console...)
- steps or a small script to reproduce it
- the MCScript version or commit and your Node.js version

You should get an answer within a week. Once a fix is released, you are credited in the changelog unless you
would rather not be.

## Supported versions

Only the latest release gets security fixes. MCScript 1.x is no longer maintained.

## Running a server safely

- Keep `verifyNames` on for any server reachable from the internet. Without it anyone can log in as any name,
  including your owners.
- Keep Node.js up to date. MCScript supports the Node.js releases that are still maintained (22, 24 and newer).
- `/pinstall` runs third-party code with the same rights as the server. Only install plugins you trust.
- The web panel listens on `127.0.0.1` by default. If you expose it, put it behind HTTPS (a reverse proxy
  such as Caddy or nginx) and keep the token secret. The token gives full console access.
- Only turn on `trustProxy` when the server sits behind your own reverse proxy. Otherwise players can fake
  their IP address and get around IP bans.
- Don't run the server as root or Administrator.
