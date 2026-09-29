# Releasing a new version

Every version is published as a GitHub release with a zip and a tar.gz of the server, the way MCGalaxy does
it. The release workflow (`.github/workflows/release.yml`) does the work once a version tag is pushed.

## Version numbers

MCScript uses [semantic versioning](https://semver.org):

- **patch** (2.0.1): bug fixes only.
- **minor** (2.1.0): new commands, plugins or settings that don't break anything.
- **major** (3.0.0): changes that break plugins or need server owners to change their config.

Pre-releases use a suffix, for example `2.1.0-beta.1`. They are marked as pre-releases on GitHub and the
update check doesn't announce them to servers on a final release.

## Steps

1. Make sure CI is green on `master`.
2. In `CHANGELOG.md`, rename the `## Unreleased` section to the new version and date, for example
   `## 2.1.0 (2026-11-02)`, and start a new empty `## Unreleased` section above it.
3. Update the version in `package.json` and `package-lock.json`:
   ```bash
   npm version 2.1.0 --no-git-tag-version
   ```
4. Commit both files with the message `Release 2.1.0` and push to `master`.
5. Tag the commit and push the tag:
   ```bash
   git tag v2.1.0
   git push origin v2.1.0
   ```

The workflow then runs the lint and tests, checks that the tag matches `package.json`, builds
`MCScript-v2.1.0.zip` and `.tar.gz` (without the tests and GitHub files) and creates the release with the
changelog section as its notes. If something fails, fix it, delete the tag (`git push --delete origin v2.1.0`,
`git tag -d v2.1.0`) and tag again.

Servers running an older version print a message in the console with a link to the new release when they start
(unless `checkForUpdates` is off).
