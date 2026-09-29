# Contributing

Bug reports, fixes and new plugins are welcome. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first;
it applies to issues, pull requests and discussions.

## Setting up

You need Node.js 22.13 or newer and git.

```bash
git clone https://github.com/perronosaurio/MCScript.git
cd MCScript
npm install
npm test
npm start
```

Join with the ClassiCube client at `127.0.0.1:25565` (local connections skip name verification).

## Before opening a pull request

- `npm run lint` passes. The project uses [JavaScript Standard Style](https://standardjs.com).
- `npm test` passes, and new behavior comes with a test. Integration tests in `test/server.test.js` start a real
  server with simulated clients, see `test/helpers/`.
- If you changed packets or anything the client sees, try it with the real ClassiCube client as well.
- Keep pull requests focused: one fix or feature each.
- Update `README.md`, `docs/` and `CHANGELOG.md` when you change how something is used.

## Code layout

- `lib/` is the core: protocol, levels, players, commands and the plugin system. Changes here affect every
  plugin, so be careful with the public API described in `docs/PLUGINS.md`.
- `plugins/` holds the bundled plugins. Most new features belong here, not in `lib/`.
- The server has no runtime dependencies and that should stay that way. If you need a library, write a plugin
  that users install on their own.

## Commit messages

A short summary in the imperative ("Fix /undo for pasted blocks"), then a blank line and a longer explanation
if it helps.

## License

By contributing you agree that your contribution is released under the [MIT License](LICENSE).
